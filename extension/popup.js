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
const NO_PAGE_MESSAGE = "Open a loaded Ultimate Guitar or GuitarTuna chord page first.";

// The readers, then the dispatcher that picks between them. The Shortcut snippet
// in public/shortcut is these same files concatenated, so which page a reader
// handles is decided in one place rather than once per front end.
const CONTENT_FILES = [
  "chord-utils-content.js",
  "guitartuna-content.js",
  "ultimate-guitar-content.js",
  "clipper-content.js"
];

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
    if (!tab?.id) throw new Error(NO_PAGE_MESSAGE);

    elements.pageStatus.textContent = "Reading page";
    const song = await readSongFromTab(tab.id);
    renderPreview(song);

    elements.pageStatus.textContent = "Saving";
    const saveResult = await saveSong(song);
    renderPreview(saveResult.song);
    setMessage(saveResult.openedApp ? "Saved to Songbook." : "Saved to local songbook.");
    elements.pageStatus.textContent = "Done";
  } catch (error) {
    setMessage(error.message || "Clip failed.", true);
    elements.pageStatus.textContent = "Not saved";
  } finally {
    setBusy(false);
  }
}

async function readSongFromTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  } catch {
    // Chrome refuses to inject into a page outside host_permissions, and its own
    // wording for that says nothing about what the user should do instead.
    throw new Error(NO_PAGE_MESSAGE);
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: readSongFromLoadedPage
  });

  if (!result?.result?.song) {
    throw new Error(result?.result?.error || "Could not extract song data from this page.");
  }

  return result.result.song;
}

// Runs in the page, where the injected files have defined songbookClipper. The
// error comes back as a value because a throw across executeScript arrives
// without its message.
function readSongFromLoadedPage() {
  return globalThis.songbookClipper.extractSong(document)
    .then((song) => ({ song }))
    .catch((error) => ({ error: error?.message || "Extraction failed." }));
}

async function saveSong(song) {
  const appUrl = normalizeAppUrl(elements.appUrlInput.value);
  elements.appUrlInput.value = appUrl;
  chrome.storage?.local?.set({ appUrl });

  // Keep retries idempotent if Chrome replaces the tab's document while the
  // background page is still loading.
  const songToSave = { ...song, id: song.id || crypto.randomUUID() };
  const { tab: appTab, shouldClose } = await getSongbookTab(appUrl);
  await importSongWhenReady(appTab.id, songToSave);
  if (shouldClose) {
    await chrome.tabs.remove(appTab.id);
  }
  return { song: songToSave, openedApp: true };
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

// chrome.tabs.query rejects a pattern with no path, so a bare origin such as
// "http://127.0.0.1:3000" has to gain the "/" that normalizeAppUrl strips.
function toMatchPattern(appUrl) {
  try {
    const url = new URL(appUrl);
    return `${url.origin}${url.pathname}*`;
  } catch {
    return `${appUrl}*`;
  }
}

async function getSongbookTab(appUrl) {
  const existingTabs = await chrome.tabs.query({ url: toMatchPattern(appUrl) });
  const tab = existingTabs.find((candidate) => !candidate.discarded)
    || existingTabs[0]
    || await chrome.tabs.create({ url: appUrl, active: false });
  if (tab.discarded) await chrome.tabs.reload(tab.id);
  return { tab, shouldClose: !existingTabs.length };
}

async function importSongWhenReady(tabId, song) {
  if (!tabId) throw new Error("Could not open Songbook tab.");

  const deadline = Date.now() + 20000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: importSongIntoSongbookPage,
        args: [song]
      });
      if (result?.result?.id === song.id) return result.result;
      lastError = new Error("Songbook did not confirm the imported song.");
    } catch (error) {
      // A newly created or restored background tab may briefly have no document
      // that an extension can access. Retry the operation that actually matters
      // instead of relying on a tab-status event that Chrome can omit or delay.
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(lastError?.message || "Could not open Songbook for importing.");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function importSongIntoSongbookPage(song) {
  const DB_NAME = "songbook";
  const DB_VERSION = 4;
  const SONG_STORE = "songs";
  const DELETED_SONG_STORE = "deletedSongs";
  const PLAYLIST_STORE = "playlists";
  const DELETED_PLAYLIST_STORE = "deletedPlaylists";

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
        if (!db.objectStoreNames.contains(DELETED_SONG_STORE)) {
          const store = db.createObjectStore(DELETED_SONG_STORE, { keyPath: "id" });
          store.createIndex("deletedAt", "deletedAt");
        }
        if (!db.objectStoreNames.contains(PLAYLIST_STORE)) {
          const store = db.createObjectStore(PLAYLIST_STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains(DELETED_PLAYLIST_STORE)) {
          const store = db.createObjectStore(DELETED_PLAYLIST_STORE, { keyPath: "id" });
          store.createIndex("deletedAt", "deletedAt");
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
      updatedAt: input.updatedAt || timestamp,
      lastOpenedAt: input.lastOpenedAt || ""
    };
  }
}
