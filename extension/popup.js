const elements = {
  pageStatus: document.querySelector("#pageStatus"),
  preview: document.querySelector("#preview"),
  songTitle: document.querySelector("#songTitle"),
  songArtist: document.querySelector("#songArtist"),
  appUrlInput: document.querySelector("#appUrlInput"),
  clipButton: document.querySelector("#clipButton"),
  message: document.querySelector("#message")
};

const DEFAULT_APP_URL = "https://maxwellriess.github.io/Songbook";

init();

function init() {
  chrome.storage?.local?.get(["appUrl"], (stored) => {
    elements.appUrlInput.value = stored.appUrl || DEFAULT_APP_URL;
  });

  elements.appUrlInput.addEventListener("change", () => {
    const appUrl = normalizeAppUrl(elements.appUrlInput.value);
    elements.appUrlInput.value = appUrl;
    chrome.storage?.local?.set({ appUrl });
  });

  elements.clipButton.addEventListener("click", clipCurrentTab);
}

async function clipCurrentTab() {
  setBusy(true);
  setMessage("");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isUltimateGuitarUrl(tab.url || "")) {
      throw new Error("Open a loaded Ultimate Guitar tab page first.");
    }

    elements.pageStatus.textContent = "Reading page";
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSongFromLoadedPage
    });

    if (!result?.result?.song) {
      throw new Error(result?.result?.error || "Could not extract song data from this page.");
    }

    const song = result.result.song;
    renderPreview(song);

    elements.pageStatus.textContent = "Saving";
    const saveResult = await saveSong(song);
    renderPreview(saveResult.song);
    setMessage(saveResult.openedApp ? "Imported into Songbook." : "Saved to local songbook.");
    elements.pageStatus.textContent = "Done";
  } catch (error) {
    setMessage(error.message || "Clip failed.", true);
    elements.pageStatus.textContent = "Not saved";
  } finally {
    setBusy(false);
  }
}

async function saveSong(song) {
  const appUrl = normalizeAppUrl(elements.appUrlInput.value);
  elements.appUrlInput.value = appUrl;
  chrome.storage?.local?.set({ appUrl });

  if (isLocalAppUrl(appUrl)) {
    try {
      const response = await fetch(`${appUrl}/api/songs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(song)
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "The local app rejected the song.");
      }

      return { song: payload, openedApp: false };
    } catch {
      // Fall through to the static PWA import flow.
    }
  }

  const appTab = await chrome.tabs.create({ url: appUrl, active: true });
  await waitForTabComplete(appTab.id);
  await chrome.scripting.executeScript({
    target: { tabId: appTab.id },
    func: importSongIntoSongbookPage,
    args: [song]
  });
  return { song, openedApp: true };
}

function renderPreview(song) {
  elements.preview.classList.remove("hidden");
  elements.songTitle.textContent = song.title || "Untitled song";
  elements.songArtist.textContent = song.artist || "Unknown artist";
}

function setBusy(isBusy) {
  elements.clipButton.disabled = isBusy;
  elements.appUrlInput.disabled = isBusy;
}

function setMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle("error", isError);
}

function normalizeAppUrl(value) {
  return (value || DEFAULT_APP_URL).trim().replace(/\/+$/, "");
}

function isLocalAppUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      reject(new Error("Could not open Songbook tab."));
      return;
    }

    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Songbook did not finish loading."));
    }, 15000);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function importSongIntoSongbookPage(song) {
  const DB_NAME = "songbook";
  const DB_VERSION = 1;
  const SONG_STORE = "songs";

  const normalizedSong = normalizeSong(song);

  return openDb()
    .then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(SONG_STORE, "readwrite");
      transaction.objectStore(SONG_STORE).put(normalizedSong);
      transaction.oncomplete = () => resolve(normalizedSong);
      transaction.onerror = () => reject(transaction.error);
    }))
    .then((savedSong) => {
      window.dispatchEvent(new CustomEvent("songbook:clip-imported", { detail: savedSong }));
      return savedSong;
    });

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SONG_STORE)) {
          const store = db.createObjectStore(SONG_STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
          store.createIndex("sourceUrl", "sourceUrl");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function normalizeSong(input) {
    const timestamp = new Date().toISOString();
    return {
      id: input.id || crypto.randomUUID(),
      title: String(input.title || "Untitled song").trim(),
      artist: String(input.artist || "Unknown artist").trim(),
      key: String(input.key || "").trim(),
      capo: String(input.capo || "").trim(),
      tuning: String(input.tuning || "").trim(),
      tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [],
      sourceUrl: String(input.sourceUrl || "").trim(),
      rawContent: String(input.rawContent || "").replace(/\r\n?/g, "\n").trim(),
      createdAt: input.createdAt || timestamp,
      updatedAt: input.updatedAt || timestamp
    };
  }
}

function isUltimateGuitarUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "ultimate-guitar.com" || url.hostname.endsWith(".ultimate-guitar.com");
  } catch {
    return false;
  }
}

function extractSongFromLoadedPage() {
  try {
    const pageData = extractUltimateGuitarDataFromDom();
    const tabView = findTabView(pageData);
    const content = getNested(tabView, ["wiki_tab", "content"]) || getNested(tabView, ["tab", "content"]) || findChordContent(pageData);
    const visibleFallback = extractVisibleTabText();
    const rawContent = normalizeContent(content || visibleFallback);

    if (!rawContent) {
      throw new Error("No chord sheet text was found on the loaded page.");
    }

    return {
      song: {
        title: tabView?.song_name || tabView?.name || inferTitle() || "Untitled song",
        artist: tabView?.artist_name || tabView?.artist?.name || inferArtist() || "Unknown artist",
        key: tabView?.tonality_name || "",
        capo: normalizeCapo(tabView?.capo),
        tuning: tabView?.tuning?.name || tabView?.tuning_name || "",
        tags: ["clipped", "ultimate-guitar"],
        sourceUrl: location.href,
        rawContent
      }
    };
  } catch (error) {
    return { error: error.message || "Extraction failed." };
  }

  function extractUltimateGuitarDataFromDom() {
    const candidates = [];

    document.querySelectorAll(".js-store[data-content], [data-content]").forEach((element) => {
      const value = element.getAttribute("data-content");
      if (value && hasTabDataMarker(value)) candidates.push(decodeHtml(value));
    });

    document.querySelectorAll("script").forEach((script) => {
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
      const parsed = tryParseJson(candidate);
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

  function extractVisibleTabText() {
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
      const element = document.querySelector(selector);
      const text = element?.innerText?.trim();
      if (text && looksLikeChordSheet(text)) return text;
    }

    const candidates = [...document.querySelectorAll("div, section")]
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

  function isPlainChordLine(line) {
    const tokens = String(line).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;

    const musicalTokens = tokens.filter((token) => !isBarToken(token));
    if (!musicalTokens.length) return false;

    const chordTokens = musicalTokens.filter(isChordToken);
    return chordTokens.length === musicalTokens.length && (chordTokens.length > 1 || line.trim().length <= 8);
  }

  function isChordToken(token) {
    const normalized = token.replace(/[.,;:]+$/g, "").replace(/^\((.*)\)$/, "$1");
    return /^[A-G](?:#|b)?(?:(?:m|maj|min|dim|aug|sus|add|M|no)?[0-9#b+\-()]*)*(?:\/[A-G](?:#|b)?)?$/.test(normalized);
  }

  function isBarToken(token) {
    return /^[|:]+$/.test(token) || /^\(?x\d+\)?$/i.test(token) || /^\(?\d+x\)?$/i.test(token) || /^N\.?C\.?$/i.test(token);
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

  function inferTitle() {
    return document.querySelector("h1")?.innerText?.trim() || document.title.replace(/\s+chords.*$/i, "").replace(/\s+\|\s+.*$/i, "").trim();
  }

  function inferArtist() {
    const artistLink = document.querySelector('a[href*="/artist/"], a[href*="/tabs/"]');
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

  function decodeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(value);
    return textarea.value;
  }
}
