(() => {
  // Ultimate Guitar ships the tab as JSON inside the server HTML and renders it
  // with React. Everything here works from a passed-in document so the same
  // reader serves the extension, the iPhone Shortcut and the tests.
  async function extractSong(doc = document) {
    if (!globalThis.songbookChordUtils?.isPlainChordLine) {
      throw new Error("Songbook chord parser did not load.");
    }

    const pageUrl = doc.location?.href || "";
    let pageData = extractUltimateGuitarData(doc);

    // Ultimate Guitar's React app deletes the js-store payload from the DOM once it
    // hydrates, so a page the user has been reading no longer carries it. Re-reading
    // the server HTML recovers the original tab data, including the [ch] chord markup.
    if (!hasUsableTabData(pageData)) {
      const serverDocument = await fetchServerDocument(pageUrl);
      if (serverDocument) pageData = extractUltimateGuitarData(serverDocument);
    }

    const tabView = findTabView(pageData);
    const tabInfo = findTabInfo(pageData);
    const meta = tabView?.meta || {};
    const jsonLd = extractJsonLdMeta(doc);
    const content = getNested(tabView, ["wiki_tab", "content"]) || getNested(tabView, ["tab", "content"]) || findChordContent(pageData);
    const rawContent = normalizeContent(content || extractVisibleTabText(doc));

    if (!rawContent) {
      throw new Error("No chord sheet text was found on the loaded page.");
    }

    return {
      title: tabInfo?.song_name || tabView?.song_name || tabView?.name || jsonLd.title || inferTitle(doc) || "Untitled song",
      artist: tabInfo?.artist_name || tabView?.artist_name || tabView?.artist?.name || jsonLd.artist || inferArtist(doc) || "Unknown artist",
      key: meta.tonality || tabInfo?.tonality_name || tabView?.tonality_name || jsonLd.key || "",
      capo: normalizeCapo(meta.capo ?? tabView?.capo ?? jsonLd.capo),
      tuning: meta.tuning?.name || meta.tuning?.value || tabView?.tuning?.name || tabView?.tuning_name || jsonLd.tuning || "",
      tags: ["clipped", "ultimate-guitar"],
      sourceUrl: pageUrl,
      rawContent
    };
  }

  function hasUsableTabData(pageData) {
    const tabView = findTabView(pageData);
    return Boolean(getNested(tabView, ["wiki_tab", "content"]) || getNested(tabView, ["tab", "content"]) || findChordContent(pageData));
  }

  async function fetchServerDocument(pageUrl) {
    try {
      const response = await fetch(pageUrl, { credentials: "include" });
      if (!response.ok) return null;
      return new DOMParser().parseFromString(await response.text(), "text/html");
    } catch {
      return null;
    }
  }

  function extractUltimateGuitarData(doc) {
    const candidates = [];

    doc.querySelectorAll(".js-store[data-content], [data-content]").forEach((element) => {
      const value = element.getAttribute("data-content");
      if (value && hasTabDataMarker(value)) candidates.push(decodeHtml(doc, value));
    });

    doc.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      if (!hasTabDataMarker(text)) return;

      const initialState = text.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/);
      if (initialState) candidates.push(initialState[1]);

      const pageStore = text.match(/window\.UGAPP\.store\.page\s*=\s*({[\s\S]*?});/);
      if (pageStore) candidates.push(pageStore[1]);

      const markerIndex = text.indexOf('"tab_view"');
      const surrounding = markerIndex >= 0 ? extractSurroundingJsonObject(text, markerIndex) : null;
      if (surrounding) candidates.push(surrounding);
    });

    for (const candidate of candidates) {
      const parsed = tryParseJson(doc, candidate);
      if (parsed && (findTabView(parsed) || findChordContent(parsed))) return parsed;
    }

    return {};
  }

  function hasTabDataMarker(value) {
    const text = String(value || "");
    const hasKnownUgKey = /tab_view|wiki_tab|song_name|artist_name|tonality_name|tab_url|tabContent|wikiTab/i.test(text);
    const hasGenericContent = /"content"\s*:|&quot;content&quot;\s*:|data-content=/i.test(text);
    const hasMusicContext = /chords|ultimate-guitar|tabs|capo|\[ch\]|\\n\s*[A-G](?:#|b)?/i.test(text);
    return (hasKnownUgKey && /content|chords|tab/i.test(text)) || (hasGenericContent && hasMusicContext);
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

      Object.values(current).forEach((child) => {
        if (child && typeof child === "object") stack.push(child);
      });
    }

    return null;
  }

  // Song, artist and key moved off tab_view and onto the sibling `tab` record.
  function findTabInfo(value) {
    if (!value || typeof value !== "object") return null;

    const stack = [value];
    const seen = new Set();

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);

      if (current.tab && typeof current.tab === "object" && current.tab.song_name) return current.tab;

      Object.values(current).forEach((child) => {
        if (child && typeof child === "object") stack.push(child);
      });
    }

    return null;
  }

  // Ultimate Guitar still publishes clean metadata as schema.org JSON-LD, which
  // survives hydration and covers pages where the tab payload cannot be read.
  function extractJsonLdMeta(doc) {
    const meta = { title: "", artist: "", key: "", capo: "", tuning: "" };

    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed = null;
      try {
        parsed = JSON.parse(script.textContent || "");
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;

      const types = [parsed["@type"]].flat();

      if (types.includes("MusicRecording")) {
        meta.title = meta.title || String(parsed.name || "").trim();
        meta.artist = meta.artist || String(parsed.byArtist?.name || "").trim();
      }

      if (types.includes("MusicComposition")) {
        meta.artist = meta.artist || String(parsed.composer?.name || "").trim();
        meta.key = meta.key || String(parsed.musicalKey || "").trim();

        // e.g. "Difficulty: Beginner Tuning: E A D G B E Key: Db Capo: 1st fret"
        const text = String(parsed.text || "");
        meta.tuning = meta.tuning || (text.match(/Tuning:\s*(.+?)\s+Key:/i)?.[1] || "").trim();
        meta.capo = meta.capo || (text.match(/Capo:\s*(\d+)\s*(?:st|nd|rd|th)?\s*fret/i)?.[1] || "").trim();
      }
    }

    return meta;
  }

  function extractVisibleTabText(doc) {
    const selectors = [
      '[data-name="tab-content"]',
      '[data-testid="tab-content"]',
      '[data-content="tab"]',
      ".js-tab-content",
      '[class*="TabContent"]',
      '[class*="tabContent"]',
      '[class*="styles__TabContent"]',
      "pre",
      "article",
      "main"
    ];

    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      const text = element?.innerText?.trim();
      if (text && looksLikeChordSheet(text)) return text;
    }

    const candidates = [...doc.querySelectorAll("div, section")]
      .map((element) => element.innerText?.trim() || "")
      .filter((text, index, list) => text.length > 80 && list.indexOf(text) === index)
      .map((text) => ({ text, score: chordSheetScore(text) }))
      .filter((candidate) => candidate.score >= 8)
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

    return candidates[0]?.text || "";
  }

  function looksLikeChordSheet(text) {
    return chordSheetScore(text) >= 8;
  }

  function chordSheetScore(text) {
    const { isPlainChordLine } = globalThis.songbookChordUtils;
    const lines = String(text || "").split("\n").map((line) => line.trimEnd());
    const bracketChordCount = (text.match(/\[ch\][\s\S]*?\[\/ch\]/gi) || []).length;
    const sectionCount = lines.filter((line) => /^\s*\[(?:Intro|Verse|Chorus|Bridge|Outro|Pre-Chorus|Interlude|Solo|Instrumental)[^\]]*\]\s*$/i.test(line)).length;
    const chordLineCount = lines.filter(isPlainChordLine).length;
    const lyricLineCount = lines.filter((line) => /[a-z]{2,}/i.test(line) && !isPlainChordLine(line)).length;

    return bracketChordCount * 6 + sectionCount * 2 + chordLineCount * 4 + Math.min(lyricLineCount, chordLineCount + 3);
  }

  function findChordContent(value) {
    const stack = [value];
    const seen = new Set();
    let best = "";
    let bestScore = 0;

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);

      for (const [key, child] of Object.entries(current)) {
        if (typeof child === "string" && /content|text|body|tab/i.test(key)) {
          const normalized = normalizeContent(child);
          const score = chordSheetScore(normalized);
          if (score > bestScore) {
            best = normalized;
            bestScore = score;
          }
        } else if (child && typeof child === "object") {
          stack.push(child);
        }
      }
    }

    return bestScore >= 8 ? best : "";
  }

  function normalizeContent(value) {
    return decodeEscapes(String(value || ""))
      .replace(/\r\n?/g, "\n")
      .replace(/\[\/?tab\]/gi, "")
      .trim();
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

  function tryParseJson(doc, source) {
    const decoded = decodeHtml(doc, source).trim();
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

  function inferTitle(doc) {
    return doc.querySelector("h1")?.innerText?.trim() || String(doc.title || "").replace(/\s+chords.*$/i, "").replace(/\s+\|\s+.*$/i, "").trim();
  }

  function inferArtist(doc) {
    const artistLink = doc.querySelector('a[href*="/artist/"], a[href*="/tabs/"]');
    return artistLink?.innerText?.trim() || "";
  }

  function normalizeCapo(value) {
    if (value === undefined || value === null || value === 0 || value === "0") return "";
    return String(value);
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

  function decodeHtml(doc, value) {
    const textarea = doc.createElement("textarea");
    textarea.innerHTML = String(value);
    return textarea.value;
  }

  globalThis.songbookUltimateGuitar = { extractSong };
})();
