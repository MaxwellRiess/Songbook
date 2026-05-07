import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_FILE = join(__dirname, "data", "songs.json");
const PUBLIC_DIR = join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const appServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      writeCorsHeaders(res);
      res.writeHead(204);
      return res.end();
    }

    if (url.pathname === "/api/songs" && req.method === "GET") {
      return sendJson(res, await readSongs());
    }

    if (url.pathname === "/api/songs" && req.method === "POST") {
      const body = await readJsonBody(req);
      const songs = await readSongs();
      const song = normalizeSong(body);
      const existingIndex = song.sourceUrl ? songs.findIndex((existingSong) => existingSong.sourceUrl === song.sourceUrl) : -1;

      if (existingIndex >= 0) {
        songs[existingIndex] = {
          ...songs[existingIndex],
          ...song,
          id: songs[existingIndex].id,
          createdAt: songs[existingIndex].createdAt,
          updatedAt: nowIso()
        };
        await saveSongs(songs);
        return sendJson(res, songs[existingIndex]);
      }

      songs.unshift(song);
      await saveSongs(songs);
      return sendJson(res, song, 201);
    }

    if (url.pathname === "/api/import" && req.method === "POST") {
      const { url: importUrl } = await readJsonBody(req);
      if (!importUrl || typeof importUrl !== "string") {
        return sendJson(res, { error: "A tab URL is required." }, 400);
      }

      const imported = await importUltimateGuitar(importUrl);
      const songs = await readSongs();
      const existingIndex = songs.findIndex((song) => song.sourceUrl === imported.sourceUrl);

      if (existingIndex >= 0) {
        songs[existingIndex] = { ...songs[existingIndex], ...imported, id: songs[existingIndex].id, updatedAt: nowIso() };
        await saveSongs(songs);
        return sendJson(res, songs[existingIndex]);
      }

      songs.unshift(imported);
      await saveSongs(songs);
      return sendJson(res, imported, 201);
    }

    if (url.pathname === "/api/songs/bulk" && req.method === "PUT") {
      const body = await readJsonBody(req);
      if (!Array.isArray(body.songs)) {
        return sendJson(res, { error: "A songs array is required." }, 400);
      }

      const songs = body.songs.map(normalizeSong);
      await saveSongs(songs);
      return sendJson(res, songs);
    }

    const songIdMatch = url.pathname.match(/^\/api\/songs\/([^/]+)$/);
    if (songIdMatch && req.method === "PUT") {
      const body = await readJsonBody(req);
      const songs = await readSongs();
      const index = songs.findIndex((song) => song.id === songIdMatch[1]);
      if (index === -1) return sendJson(res, { error: "Song not found." }, 404);

      songs[index] = normalizeSong({ ...songs[index], ...body, id: songs[index].id, updatedAt: nowIso() });
      await saveSongs(songs);
      return sendJson(res, songs[index]);
    }

    if (songIdMatch && req.method === "DELETE") {
      const songs = await readSongs();
      const nextSongs = songs.filter((song) => song.id !== songIdMatch[1]);
      if (nextSongs.length === songs.length) return sendJson(res, { error: "Song not found." }, 404);

      await saveSongs(nextSongs);
      writeCorsHeaders(res);
      res.writeHead(204);
      return res.end();
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, { error: error.message || "Unexpected server error." }, 500);
  }
});

if (isMainModule()) {
  appServer.listen(PORT, HOST, () => {
    console.log(`Lyrics and chords app running at http://${HOST}:${PORT}`);
  });
}

async function readSongs() {
  if (!existsSync(DATA_FILE)) return [];
  const raw = await readFile(DATA_FILE, "utf8");
  return raw.trim() ? JSON.parse(raw) : [];
}

async function saveSongs(songs) {
  await writeFile(DATA_FILE, `${JSON.stringify(songs, null, 2)}\n`, "utf8");
}

async function importUltimateGuitar(sourceUrl) {
  const parsedUrl = new URL(sourceUrl);
  if (!/ultimate-guitar\.com$/i.test(parsedUrl.hostname) && !/\.ultimate-guitar\.com$/i.test(parsedUrl.hostname)) {
    throw new Error("Only ultimate-guitar.com URLs are supported by this importer.");
  }

  const response = await fetch(parsedUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; LyricsChordsLibrary/0.1; +http://localhost)"
    }
  });

  if (!response.ok) {
    const challenge = response.headers.get("cf-mitigated") === "challenge";
    if (response.status === 403 && challenge) {
      throw new Error("Ultimate Guitar blocked the automated request with a Cloudflare challenge. Create the song manually and paste the chord text, or try again from a network/browser session that Ultimate Guitar allows.");
    }
    throw new Error(`Ultimate Guitar returned ${response.status}.`);
  }

  const html = await response.text();
  const pageData = extractUltimateGuitarData(html);
  const tabView = findTabView(pageData);
  const content = getNested(tabView, ["wiki_tab", "content"]) || getNested(tabView, ["tab", "content"]);

  if (!content || typeof content !== "string") {
    throw new Error("Could not find chord content in the Ultimate Guitar page.");
  }

  const cleanedContent = decodeEscapes(content)
    .replace(/\r\n?/g, "\n")
    .replace(/\[\/?tab\]/gi, "")
    .trim();

  return normalizeSong({
    title: tabView.song_name || tabView.name || inferTitleFromHtml(html) || "Untitled song",
    artist: tabView.artist_name || tabView.artist?.name || inferArtistFromHtml(html) || "Unknown artist",
    key: tabView.tonality_name || "",
    capo: normalizeCapo(tabView.capo),
    tuning: tabView.tuning?.name || tabView.tuning_name || "Standard",
    sourceUrl: parsedUrl.toString(),
    rawContent: cleanedContent,
    tags: ["imported", "ultimate-guitar"]
  });
}

function extractUltimateGuitarData(html) {
  const candidates = [];

  for (const match of html.matchAll(/<div[^>]+class=["'][^"']*js-store[^"']*["'][^>]+data-content=(["'])(.*?)\1/gis)) {
    candidates.push(decodeHtml(match[2]));
  }

  for (const match of html.matchAll(/window\.__INITIAL_STATE__\s*=\s*({.*?});\s*<\/script>/gis)) {
    candidates.push(match[1]);
  }

  for (const match of html.matchAll(/window\.UGAPP\.store\.page\s*=\s*({.*?});\s*<\/script>/gis)) {
    candidates.push(match[1]);
  }

  const pageMarkerIndex = html.indexOf('"tab_view"');
  if (pageMarkerIndex >= 0) {
    const objectSource = extractSurroundingJsonObject(html, pageMarkerIndex);
    if (objectSource) candidates.push(objectSource);
  }

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed && findTabView(parsed)) return parsed;
  }

  throw new Error("Could not parse Ultimate Guitar page data.");
}

function findTabView(value) {
  if (!value || typeof value !== "object") return null;
  if (value.tab_view && typeof value.tab_view === "object") return value.tab_view;

  const stack = [value];
  const seen = new Set();

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (current.tab_view && typeof current.tab_view === "object") return current.tab_view;
    if (current.store?.page?.data?.tab_view) return current.store.page.data.tab_view;
    if (current.page?.data?.tab_view) return current.page.data.tab_view;

    for (const child of Object.values(current)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }

  return null;
}

function extractSurroundingJsonObject(source, markerIndex) {
  let start = markerIndex;
  while (start >= 0 && source[start] !== "{") start -= 1;
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') inString = true;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  return null;
}

function tryParseJson(source) {
  const decoded = decodeHtml(source).trim();
  try {
    return JSON.parse(decoded);
  } catch {
    const unescaped = decoded.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    try {
      return JSON.parse(unescaped);
    } catch {
      return null;
    }
  }
}

function normalizeSong(input) {
  const timestamp = nowIso();
  const rawContent = String(input.rawContent || "").replace(/\r\n?/g, "\n").trim();

  return {
    id: input.id || randomUUID(),
    title: String(input.title || "Untitled song").trim(),
    artist: String(input.artist || "Unknown artist").trim(),
    key: String(input.key || "").trim(),
    capo: String(input.capo || "").trim(),
    tuning: String(input.tuning || "").trim(),
    tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [],
    sourceUrl: String(input.sourceUrl || "").trim(),
    rawContent,
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp
  };
}

function normalizeCapo(value) {
  if (value === undefined || value === null || value === 0 || value === "0") return "";
  return String(value);
}

function inferTitleFromHtml(html) {
  const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1];
  if (!title) return "";
  return decodeHtml(title).replace(/\s+chords.*$/i, "").replace(/\s+\|\s+.*$/i, "").trim();
}

function inferArtistFromHtml(html) {
  const artist = html.match(/"artist_name"\s*:\s*"([^"]+)"/i)?.[1];
  return artist ? decodeEscapes(artist) : "";
}

function getNested(source, path) {
  return path.reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), source);
}

function decodeEscapes(value) {
  const text = String(value);
  if (!/\\(?:n|r|t|"|\\|u[0-9a-f]{4})/i.test(text)) return text;

  try {
    return JSON.parse(`"${text.replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`);
  } catch {
    return text;
  }
}

function decodeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const target = normalize(join(PUBLIC_DIR, safePath));

  if (!target.startsWith(PUBLIC_DIR)) {
    return sendJson(res, { error: "Not found." }, 404);
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, { "content-type": MIME_TYPES[extname(target)] || "application/octet-stream" });
    return res.end(body);
  } catch {
    return sendJson(res, { error: "Not found." }, 404);
  }
}

function sendJson(res, body, status = 200) {
  writeCorsHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function nowIso() {
  return new Date().toISOString();
}

function writeCorsHeaders(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

export {
  decodeEscapes,
  extractUltimateGuitarData,
  findTabView,
  importUltimateGuitar,
  normalizeSong
};
