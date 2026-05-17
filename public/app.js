const state = {
  songs: [],
  selectedId: null,
  editingId: null,
  transpose: 0,
  fontSize: 16,
  autoscrollActive: false,
  autoscrollSpeed: 45,
  autoscrollFrameId: null,
  autoscrollLastTime: null,
  autoscrollRemainder: 0,
  supabaseClient: null,
  supabaseUser: null,
  supabaseConfig: null,
  syncBusy: false,
  query: ""
};

const elements = {
  appShell: document.querySelector("#appShell"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  songCount: document.querySelector("#songCount"),
  songList: document.querySelector("#songList"),
  searchInput: document.querySelector("#searchInput"),
  syncStatus: document.querySelector("#syncStatus"),
  syncNowButton: document.querySelector("#syncNowButton"),
  syncSettingsButton: document.querySelector("#syncSettingsButton"),
  newSongButton: document.querySelector("#newSongButton"),
  artistMeta: document.querySelector("#artistMeta"),
  songTitle: document.querySelector("#songTitle"),
  songMeta: document.querySelector("#songMeta"),
  viewer: document.querySelector("#viewer"),
  editButton: document.querySelector("#editButton"),
  deleteButton: document.querySelector("#deleteButton"),
  copyButton: document.querySelector("#copyButton"),
  transposeSelect: document.querySelector("#transposeSelect"),
  fontSizeInput: document.querySelector("#fontSizeInput"),
  themeSelect: document.querySelector("#themeSelect"),
  autoscrollControls: document.querySelector("#autoscrollControls"),
  autoscrollToggle: document.querySelector("#autoscrollToggle"),
  autoscrollSpeed: document.querySelector("#autoscrollSpeed"),
  autoscrollSpeedValue: document.querySelector("#autoscrollSpeedValue"),
  dialog: document.querySelector("#songDialog"),
  dialogTitle: document.querySelector("#dialogTitle"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
  cancelButton: document.querySelector("#cancelButton"),
  songForm: document.querySelector("#songForm"),
  titleInput: document.querySelector("#titleInput"),
  artistInput: document.querySelector("#artistInput"),
  keyInput: document.querySelector("#keyInput"),
  capoInput: document.querySelector("#capoInput"),
  tuningInput: document.querySelector("#tuningInput"),
  tagsInput: document.querySelector("#tagsInput"),
  contentInput: document.querySelector("#contentInput"),
  syncDialog: document.querySelector("#syncDialog"),
  syncForm: document.querySelector("#syncForm"),
  closeSyncDialogButton: document.querySelector("#closeSyncDialogButton"),
  supabaseUrlInput: document.querySelector("#supabaseUrlInput"),
  supabaseAnonKeyInput: document.querySelector("#supabaseAnonKeyInput"),
  syncEmailInput: document.querySelector("#syncEmailInput"),
  sendMagicLinkButton: document.querySelector("#sendMagicLinkButton"),
  signOutButton: document.querySelector("#signOutButton"),
  toast: document.querySelector("#toast")
};

const SUPABASE_CONFIG_KEY = "songbook.supabase.config";
const SIDEBAR_COLLAPSED_KEY = "songbook.sidebar.collapsed";
const THEME_KEY = "songbook.theme";
const THEMES = ["vintage", "zine", "analog", "stage", "editorial"];
const DB_NAME = "songbook";
const DB_VERSION = 1;
const SONG_STORE = "songs";

const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#"
};

await initializeSupabase();
await loadSongs();
const clippedSong = await consumeClipImportFromLocation();
if (clippedSong) {
  state.songs = await getStoredSongs();
  state.selectedId = clippedSong.id;
  await syncSongToSupabase(clippedSong);
}
restoreSidebarState();
restoreTheme();
bindEvents();
render();
if (clippedSong) toast("Clipped song imported");
registerServiceWorker();

async function loadSongs() {
  state.songs = await getStoredSongs();
  if (!state.songs.length) {
    const legacySongs = await tryLoadLegacyServerSongs();
    if (legacySongs.length) {
      await saveStoredSongs(legacySongs);
      state.songs = legacySongs;
    }
  }
  state.selectedId = state.songs[0]?.id || null;
}

function bindEvents() {
  elements.searchInput.addEventListener("input", () => {
    state.query = elements.searchInput.value.trim().toLowerCase();
    renderSongList();
  });

  elements.sidebarToggle.addEventListener("click", () => {
    setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed"));
  });

  elements.themeSelect.addEventListener("change", () => {
    applyTheme(elements.themeSelect.value);
  });

  elements.newSongButton.addEventListener("click", () => openSongDialog());
  elements.editButton.addEventListener("click", () => openSongDialog(getSelectedSong()));
  elements.deleteButton.addEventListener("click", deleteSelectedSong);
  elements.copyButton.addEventListener("click", copySelectedSong);
  elements.syncSettingsButton.addEventListener("click", openSyncDialog);
  elements.syncNowButton.addEventListener("click", syncWithSupabase);
  elements.closeSyncDialogButton.addEventListener("click", () => elements.syncDialog.close());
  elements.sendMagicLinkButton.addEventListener("click", sendMagicLink);
  elements.signOutButton.addEventListener("click", signOutOfSupabase);
  elements.closeDialogButton.addEventListener("click", () => elements.dialog.close());
  elements.cancelButton.addEventListener("click", () => elements.dialog.close());

  elements.transposeSelect.addEventListener("change", () => {
    state.transpose = Number(elements.transposeSelect.value);
    renderSelectedSong();
  });

  elements.fontSizeInput.addEventListener("input", () => {
    state.fontSize = Number(elements.fontSizeInput.value);
    elements.viewer.style.setProperty("--sheet-font-size", `${state.fontSize}px`);
  });

  elements.autoscrollToggle.addEventListener("click", () => {
    toggleAutoscroll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" && event.key !== " ") return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    if (elements.dialog?.open || elements.syncDialog?.open) return;
    if (!getSelectedSong()) return;
    event.preventDefault();
    toggleAutoscroll();
  });

  elements.autoscrollSpeed.addEventListener("input", () => {
    state.autoscrollSpeed = Number(elements.autoscrollSpeed.value);
    updateAutoscrollControls();
  });

  elements.viewer.addEventListener("scroll", () => {
    if (state.autoscrollActive && isAutoscrollAtBottom()) {
      stopAutoscroll();
    }
  });

  window.addEventListener("scroll", () => {
    if (state.autoscrollActive && isAutoscrollAtBottom()) {
      stopAutoscroll();
    }
  });

  elements.songForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSongFromDialog();
  });

  elements.syncForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSupabaseSettings();
  });

  window.addEventListener("songbook:clip-imported", async (event) => {
    const song = normalizeSong(event.detail || {});
    state.songs = await getStoredSongs();
    state.selectedId = song.id;
    await syncSongToSupabase(song);
    render();
    toast("Clipped song imported");
  });
}

function render() {
  renderSongList();
  renderSelectedSong();
}

function renderSongList() {
  const songs = getFilteredSongs();
  elements.songCount.textContent = `${state.songs.length} ${state.songs.length === 1 ? "song" : "songs"}`;
  elements.songList.replaceChildren();

  if (!songs.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = state.songs.length ? "No matches" : "No songs yet";
    elements.songList.append(empty);
    return;
  }

  for (const song of songs) {
    const button = document.createElement("button");
    button.className = `song-row${song.id === state.selectedId ? " active" : ""}`;
    button.type = "button";
    button.addEventListener("click", () => {
      state.selectedId = song.id;
      state.transpose = 0;
      elements.transposeSelect.value = "0";
      stopAutoscroll();
      render();
    });

    const title = document.createElement("strong");
    title.textContent = song.title;

    const meta = document.createElement("span");
    meta.textContent = [song.artist, song.key && `Key ${song.key}`].filter(Boolean).join(" · ");

    button.append(title, meta);
    elements.songList.append(button);
  }
}

function renderSelectedSong() {
  const song = getSelectedSong();
  const hasSong = Boolean(song);
  elements.editButton.disabled = !hasSong;
  elements.deleteButton.disabled = !hasSong;
  elements.copyButton.disabled = !hasSong;
  elements.autoscrollToggle.disabled = !hasSong;
  elements.autoscrollControls.classList.toggle("hidden", !hasSong);
  elements.viewer.style.setProperty("--sheet-font-size", `${state.fontSize}px`);

  if (!song) {
    stopAutoscroll();
    elements.artistMeta.textContent = "No song selected";
    elements.songTitle.textContent = "Add or clip a song";
    elements.songMeta.replaceChildren();
    elements.viewer.className = "viewer empty-state";
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "Use the clipper or create a song manually.";
    elements.viewer.replaceChildren(emptyMessage);
    return;
  }

  elements.artistMeta.textContent = song.artist;
  elements.songTitle.textContent = song.title;
  elements.songMeta.replaceChildren(...buildMetaPills(song));
  elements.viewer.className = "viewer sheet";
  renderSheet(song);
}

function renderSheet(song) {
  const fragment = document.createDocumentFragment();
  const normalized = stripTabTags(song.rawContent || "");
  const lines = normalized.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || "";
    const cleanedLine = removeUgTags(line);

    if (isPlainChordLine(cleanedLine) && nextLine.trim() && !isPlainChordLine(removeUgTags(nextLine))) {
      fragment.append(renderResponsiveChordLyricPair(cleanedLine, removeUgTags(nextLine), state.transpose));
      index += 1;
      continue;
    }

    const row = renderLine(line, state.transpose);
    fragment.append(row);
  }

  elements.viewer.replaceChildren(fragment);
}

function renderLine(line, transpose) {
  const sectionMatch = line.trim().match(/^\[([^\]]+)\]$/);
  if (sectionMatch && !/ch\]/i.test(line)) {
    const section = document.createElement("div");
    section.className = "section-label";
    section.textContent = sectionMatch[1];
    return section;
  }

  const cleanedLine = removeUgTags(line);
  if (isPlainChordLine(cleanedLine)) {
    const chordLine = document.createElement("div");
    chordLine.className = "sheet-line plain-chord-line";
    chordLine.textContent = transposeChordLine(cleanedLine, transpose);
    return chordLine;
  }

  const parsed = parseChordLine(line, 0);

  if (!parsed.hasChords) {
    const wrapper = document.createElement("div");
    wrapper.className = "sheet-line";
    wrapper.textContent = parsed.lyrics;
    return wrapper;
  }

  return renderResponsiveChordLyricPair(parsed.chords, parsed.lyrics, transpose);
}

function renderResponsiveChordLyricPair(chordLine, lyricLine, transpose) {
  const wrapper = document.createElement("div");
  wrapper.className = "sheet-line chord-lyric-pair";

  const desktopChordLine = document.createElement("div");
  desktopChordLine.className = "plain-chord-line pair-desktop-chords";
  desktopChordLine.textContent = transposeChordLine(chordLine, transpose);

  const desktopLyricLine = document.createElement("div");
  desktopLyricLine.className = "pair-desktop-lyrics";
  desktopLyricLine.textContent = lyricLine;

  const mobileLine = document.createElement("div");
  mobileLine.className = "mobile-flow-line";

  buildMobileChordLyricSegments(chordLine, lyricLine, transpose).forEach((segment) => {
    const item = document.createElement("span");
    item.className = "mobile-flow-segment";

    const chord = document.createElement("span");
    chord.className = "mobile-flow-chord";
    chord.textContent = segment.chord || "\u00a0";

    const lyric = document.createElement("span");
    lyric.className = "mobile-flow-lyric";
    lyric.textContent = segment.lyric || "\u00a0";

    item.append(chord, lyric);
    mobileLine.append(item);
  });

  wrapper.append(desktopChordLine, desktopLyricLine, mobileLine);
  return wrapper;
}

function buildMobileChordLyricSegments(chordLine, lyricLine, transpose) {
  const chordMatches = [...chordLine.matchAll(/\S+/g)].filter((match) => isChordToken(match[0]));
  if (!chordMatches.length) return [{ chord: "", lyric: lyricLine.trim() }];

  const snapToWordStart = (rawPos) => {
    if (rawPos <= 0) return 0;
    let p = Math.min(rawPos, lyricLine.length);
    while (p > 0 && !/\s/.test(lyricLine[p - 1])) p -= 1;
    return p;
  };

  const positions = chordMatches.map((match) => snapToWordStart(match.index || 0));
  const segments = [];

  if (positions[0] > 0) {
    const leading = lyricLine.slice(0, positions[0]).trim();
    if (leading) segments.push({ chord: "", lyric: leading });
  }

  for (let i = 0; i < chordMatches.length; i += 1) {
    const start = positions[i];
    const end = i + 1 < chordMatches.length ? positions[i + 1] : lyricLine.length;
    const lyric = lyricLine.slice(start, end).trim();
    segments.push({
      chord: transposeChord(chordMatches[i][0], transpose),
      lyric
    });
  }

  return segments.filter((segment) => segment.chord || segment.lyric);
}

function parseChordLine(line, transpose) {
  let lyricPosition = 0;
  let lyrics = "";
  let chords = "";
  let hasChords = false;
  const tokenRegex = /\[ch\]([\s\S]*?)\[\/ch\]/gi;
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(line)) !== null) {
    const lyricPart = removeUgTags(line.slice(lastIndex, match.index));
    lyrics += lyricPart;
    lyricPosition += lyricPart.length;

    const chord = transposeChord(match[1], transpose);
    chords = padEnd(chords, lyricPosition);
    chords += chord;
    hasChords = true;
    lastIndex = tokenRegex.lastIndex;
  }

  const trailing = removeUgTags(line.slice(lastIndex));
  lyrics += trailing;

  return { lyrics, chords, hasChords };
}

function transposeChord(chord, steps) {
  if (!steps) return chord;

  return chord.replace(/(^|[^A-Ga-g#b])([A-G])([#b]?)(?=(?:[Mm]aj|[Mm]in|[Dd]im|[Aa]ug|[Ss]us|[Aa]dd|[Nn]o|m|M|[0-9()/+\-]|$))/g, (full, prefix, note, accidental) => {
    const normalized = `${note.toUpperCase()}${accidental || ""}`;
    const sharpNote = FLAT_TO_SHARP[normalized] || normalized;
    const index = NOTES_SHARP.indexOf(sharpNote);
    if (index === -1) return full;
    const next = NOTES_SHARP[(index + steps + 120) % 12];
    return `${prefix}${next}`;
  });
}

function transposeChordLine(line, steps) {
  if (!steps) return line;
  return line.replace(/\S+/g, (token) => (isChordToken(token) ? transposeChord(token, steps) : token));
}

function isPlainChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;

  const musicalTokens = tokens.filter((token) => !isBarToken(token));
  if (!musicalTokens.length) return false;

  const chordTokens = musicalTokens.filter(isChordToken);
  return chordTokens.length === musicalTokens.length && (chordTokens.length > 1 || line.trim().length <= 8);
}

function isChordToken(token) {
  const normalized = token.replace(/[.,;:]+$/g, "").replace(/^\((.*)\)$/, "$1");
  return /^[A-G](?:#|b)?(?:(?:[Mm]aj|[Mm]in|[Dd]im|[Aa]ug|[Ss]us|[Aa]dd|[Nn]o|m|M)?[0-9#b+\-()]*)*(?:\/[A-G](?:#|b)?)?$/.test(normalized);
}

function isBarToken(token) {
  return /^[|:]+$/.test(token) || /^\(?x\d+\)?$/i.test(token) || /^\(?\d+x\)?$/i.test(token) || /^N\.?C\.?$/i.test(token);
}

function startAutoscroll() {
  if (!getSelectedSong() || state.autoscrollActive) return;
  if (isAutoscrollAtBottom()) return;
  state.autoscrollActive = true;
  state.autoscrollLastTime = null;
  state.autoscrollRemainder = 0;
  updateAutoscrollControls();
  state.autoscrollFrameId = window.requestAnimationFrame(stepAutoscroll);
}

function stopAutoscroll() {
  state.autoscrollActive = false;
  state.autoscrollLastTime = null;
  state.autoscrollRemainder = 0;
  if (state.autoscrollFrameId) {
    window.cancelAnimationFrame(state.autoscrollFrameId);
    state.autoscrollFrameId = null;
  }
  updateAutoscrollControls();
}

function stepAutoscroll(timestamp) {
  if (!state.autoscrollActive) return;

  if (state.autoscrollLastTime === null) {
    state.autoscrollLastTime = timestamp;
  }

  const elapsedSeconds = Math.min((timestamp - state.autoscrollLastTime) / 1000, 0.08);
  state.autoscrollLastTime = timestamp;
  const scrollTarget = getAutoscrollTarget();
  const scrollDelta = state.autoscrollSpeed * elapsedSeconds + state.autoscrollRemainder;
  const wholePixels = Math.trunc(scrollDelta);
  state.autoscrollRemainder = scrollDelta - wholePixels;

  if (wholePixels > 0) {
    scrollTarget.scrollTop += wholePixels;
  }

  if (isAutoscrollAtBottom()) {
    stopAutoscroll();
    return;
  }

  state.autoscrollFrameId = window.requestAnimationFrame(stepAutoscroll);
}

function getAutoscrollTarget() {
  if (canScroll(elements.viewer)) return elements.viewer;
  return document.scrollingElement || document.documentElement;
}

function canScroll(element) {
  return element.scrollHeight - element.clientHeight > 2;
}

function isAutoscrollAtBottom() {
  const scrollTarget = getAutoscrollTarget();
  return scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 2;
}

function updateAutoscrollControls() {
  elements.autoscrollToggle.textContent = state.autoscrollActive ? "Stop" : "Start";
  elements.autoscrollToggle.setAttribute("aria-pressed", String(state.autoscrollActive));
  elements.autoscrollSpeed.value = String(state.autoscrollSpeed);
  elements.autoscrollSpeedValue.value = `${state.autoscrollSpeed} px/s`;
  elements.autoscrollControls.classList.toggle("is-active", state.autoscrollActive);
}

function hasLocalApi() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

async function getStoredSongs() {
  const db = await openSongbookDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SONG_STORE, "readonly");
    const request = transaction.objectStore(SONG_STORE).getAll();
    request.onsuccess = () => {
      const songs = request.result || [];
      songs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      resolve(songs);
    };
    request.onerror = () => reject(request.error);
  });
}

async function upsertStoredSong(song) {
  const db = await openSongbookDb();
  const normalized = normalizeSong(song);
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(SONG_STORE, "readwrite");
    transaction.objectStore(SONG_STORE).put(normalized);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  return normalized;
}

async function saveStoredSongs(songs) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(SONG_STORE, "readwrite");
    const store = transaction.objectStore(SONG_STORE);
    store.clear();
    songs.map(normalizeSong).forEach((song) => store.put(song));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function deleteStoredSong(songId) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(SONG_STORE, "readwrite");
    transaction.objectStore(SONG_STORE).delete(songId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function openSongbookDb() {
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

async function tryLoadLegacyServerSongs() {
  if (!hasLocalApi()) return [];

  try {
    const response = await fetch("/api/songs");
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return [];
    const songs = await response.json();
    return Array.isArray(songs) ? songs.map(normalizeSong) : [];
  } catch {
    return [];
  }
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

async function consumeClipImportFromLocation() {
  const hash = window.location.hash || "";
  const match = hash.match(/^#import=([^&]+)/);
  if (!match) return null;

  try {
    const song = normalizeSong(JSON.parse(decodeBase64Url(match[1])));
    const savedSong = await upsertStoredSong(song);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return savedSong;
  } catch (error) {
    console.error(error);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    toast("Could not import clipped song.", true);
    return null;
  }
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}

async function initializeSupabase() {
  state.supabaseConfig = readSupabaseConfig();
  if (!state.supabaseConfig) {
    updateSyncStatus();
    return;
  }

  if (!window.supabase?.createClient) {
    updateSyncStatus("Supabase library unavailable");
    return;
  }

  state.supabaseClient = window.supabase.createClient(state.supabaseConfig.url, state.supabaseConfig.anonKey);
  const { data, error } = await state.supabaseClient.auth.getSession();
  if (error) {
    updateSyncStatus(error.message);
    return;
  }

  state.supabaseUser = data.session?.user || null;
  state.supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    state.supabaseUser = session?.user || null;
    updateSyncStatus();
    if (state.supabaseUser) await syncWithSupabase();
  });
  updateSyncStatus();
}

function readSupabaseConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(SUPABASE_CONFIG_KEY) || "null");
    if (!stored?.url || !stored?.anonKey) return null;
    return stored;
  } catch {
    return null;
  }
}

function openSyncDialog() {
  elements.supabaseUrlInput.value = state.supabaseConfig?.url || "";
  elements.supabaseAnonKeyInput.value = state.supabaseConfig?.anonKey || "";
  elements.syncDialog.showModal();
}

async function saveSupabaseSettings() {
  const url = elements.supabaseUrlInput.value.trim().replace(/\/+$/, "");
  const anonKey = elements.supabaseAnonKeyInput.value.trim();
  if (!url || !anonKey) {
    toast("Supabase URL and anon key are required.", true);
    return;
  }

  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url, anonKey }));
  state.supabaseConfig = { url, anonKey };
  state.supabaseClient = window.supabase?.createClient(url, anonKey) || null;
  state.supabaseUser = null;
  elements.syncDialog.close();
  updateSyncStatus();

  if (!state.supabaseClient) {
    toast("Supabase library is not loaded.", true);
    return;
  }

  const { data, error } = await state.supabaseClient.auth.getSession();
  if (error) {
    toast(error.message, true);
    return;
  }

  state.supabaseUser = data.session?.user || null;
  updateSyncStatus();
  toast("Saved Supabase settings");
}

async function sendMagicLink() {
  if (!state.supabaseClient) {
    await saveSupabaseSettings();
  }
  if (!state.supabaseClient) return;

  const email = elements.syncEmailInput.value.trim();
  if (!email) {
    toast("Enter an email address.", true);
    return;
  }

  const { error } = await state.supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href }
  });
  if (error) {
    toast(error.message, true);
    return;
  }

  toast("Magic link sent. Open it in this browser.");
}

async function signOutOfSupabase() {
  if (!state.supabaseClient) return;
  const { error } = await state.supabaseClient.auth.signOut();
  if (error) {
    toast(error.message, true);
    return;
  }
  state.supabaseUser = null;
  updateSyncStatus();
  toast("Signed out");
}

async function syncWithSupabase() {
  if (!canUseSupabase() || state.syncBusy) return;
  state.syncBusy = true;
  updateSyncStatus("Syncing");

  try {
    const { data, error } = await state.supabaseClient
      .from("songs")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const remoteSongs = (data || []).map(songFromSupabaseRow);
    const mergedSongs = mergeSongs(state.songs, remoteSongs);
    await saveLocalSongs(mergedSongs);
    state.songs = mergedSongs;
    state.selectedId = mergedSongs.some((song) => song.id === state.selectedId) ? state.selectedId : mergedSongs[0]?.id || null;

    if (mergedSongs.length) {
      const rows = mergedSongs.map(songToSupabaseRow);
      const { error: upsertError } = await state.supabaseClient.from("songs").upsert(rows, { onConflict: "id" });
      if (upsertError) throw upsertError;
    }

    updateSyncStatus("Synced");
    render();
  } catch (error) {
    updateSyncStatus(error.message || "Sync failed");
    toast(error.message || "Sync failed", true);
  } finally {
    state.syncBusy = false;
    updateSyncStatus();
  }
}

async function syncSongToSupabase(song) {
  if (!canUseSupabase()) return;
  const { error } = await state.supabaseClient.from("songs").upsert(songToSupabaseRow(song), { onConflict: "id" });
  if (error) {
    updateSyncStatus(error.message);
    toast(error.message, true);
    return;
  }
  updateSyncStatus("Synced");
}

async function deleteSongFromSupabase(songId) {
  if (!canUseSupabase()) return;
  const { error } = await state.supabaseClient.from("songs").delete().eq("id", songId);
  if (error) {
    updateSyncStatus(error.message);
    toast(error.message, true);
  }
}

function canUseSupabase() {
  return Boolean(state.supabaseClient && state.supabaseUser);
}

function updateSyncStatus(message = "") {
  if (!state.supabaseConfig) {
    elements.syncStatus.textContent = "Local only";
    elements.syncNowButton.disabled = true;
    return;
  }

  if (message) {
    elements.syncStatus.textContent = message;
  } else if (state.supabaseUser) {
    elements.syncStatus.textContent = state.syncBusy ? "Syncing" : "Signed in";
  } else {
    elements.syncStatus.textContent = "Not signed in";
  }

  elements.syncNowButton.disabled = !canUseSupabase() || state.syncBusy;
}

async function saveLocalSongs(songs) {
  await saveStoredSongs(songs);
}

function mergeSongs(localSongs, remoteSongs) {
  const byId = new Map();
  for (const song of [...remoteSongs, ...localSongs]) {
    const existing = byId.get(song.id);
    if (!existing || new Date(song.updatedAt) > new Date(existing.updatedAt)) {
      byId.set(song.id, song);
    }
  }
  return [...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function songToSupabaseRow(song) {
  return {
    id: song.id,
    user_id: state.supabaseUser.id,
    title: song.title,
    artist: song.artist,
    song_key: song.key || "",
    capo: song.capo || "",
    tuning: song.tuning || "",
    tags: song.tags || [],
    source_url: song.sourceUrl || "",
    raw_content: song.rawContent || "",
    created_at: song.createdAt,
    updated_at: song.updatedAt
  };
}

function songFromSupabaseRow(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    key: row.song_key || "",
    capo: row.capo || "",
    tuning: row.tuning || "",
    tags: row.tags || [],
    sourceUrl: row.source_url || "",
    rawContent: row.raw_content || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildMetaPills(song) {
  const values = [
    song.key && `Key ${song.key}`,
    song.capo && `Capo ${song.capo}`,
    song.tuning,
    ...(song.tags || [])
  ].filter(Boolean);

  return values.map((value) => {
    const pill = document.createElement("span");
    pill.textContent = value;
    return pill;
  });
}

function openSongDialog(song = null) {
  state.editingId = song?.id || null;
  elements.dialogTitle.textContent = song ? "Edit song" : "New song";
  elements.titleInput.value = song?.title || "";
  elements.artistInput.value = song?.artist || "";
  elements.keyInput.value = song?.key || "";
  elements.capoInput.value = song?.capo || "";
  elements.tuningInput.value = song?.tuning || "";
  elements.tagsInput.value = (song?.tags || []).join(", ");
  elements.contentInput.value = song?.rawContent || "";
  elements.dialog.showModal();
  elements.titleInput.focus();
}

async function saveSongFromDialog() {
  const payload = {
    id: state.editingId || undefined,
    title: elements.titleInput.value,
    artist: elements.artistInput.value,
    key: elements.keyInput.value,
    capo: elements.capoInput.value,
    tuning: elements.tuningInput.value,
    tags: elements.tagsInput.value.split(",").map((tag) => tag.trim()).filter(Boolean),
    rawContent: elements.contentInput.value
  };

  const existing = state.editingId ? getSelectedSong() : null;
  const song = await upsertStoredSong(normalizeSong({ ...existing, ...payload, updatedAt: new Date().toISOString() }));
  state.songs = await getStoredSongs();
  state.selectedId = song.id;
  await syncSongToSupabase(song);
  elements.dialog.close();
  toast("Saved song");
  render();
}

async function deleteSelectedSong() {
  const song = getSelectedSong();
  if (!song) return;
  const confirmed = window.confirm(`Delete "${song.title}"?`);
  if (!confirmed) return;

  stopAutoscroll();
  await deleteStoredSong(song.id);
  await deleteSongFromSupabase(song.id);
  state.songs = await getStoredSongs();
  state.selectedId = state.songs[0]?.id || null;
  toast("Deleted song");
  render();
}

async function copySelectedSong() {
  const song = getSelectedSong();
  if (!song) return;
  await navigator.clipboard.writeText(toPlainChordSheet(song));
  toast("Copied song");
}

function toPlainChordSheet(song) {
  const header = [`${song.title} - ${song.artist}`];
  const meta = [song.key && `Key: ${song.key}`, song.capo && `Capo: ${song.capo}`, song.tuning && `Tuning: ${song.tuning}`]
    .filter(Boolean)
    .join(" | ");
  if (meta) header.push(meta);
  return `${header.join("\n")}\n\n${stripTabTags(song.rawContent || "")}`;
}

function getFilteredSongs() {
  if (!state.query) return state.songs;
  return state.songs.filter((song) => {
    const haystack = [song.title, song.artist, song.key, song.rawContent, ...(song.tags || [])].join(" ").toLowerCase();
    return haystack.includes(state.query);
  });
}

function getSelectedSong() {
  return state.songs.find((song) => song.id === state.selectedId) || null;
}

function stripTabTags(value) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, "    ")
    .replace(/\[\/?tab\]/gi, "");
}

function removeUgTags(value) {
  return stripTabTags(value)
    .replace(/\[(?:\/)?(?:b|i|u)\]/gi, "")
    .replace(/\[url[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1");
}

function padEnd(value, length) {
  return value.length >= length ? value : `${value}${" ".repeat(length - value.length)}`;
}

function toggleAutoscroll() {
  if (state.autoscrollActive) {
    stopAutoscroll();
  } else {
    startAutoscroll();
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target.isContentEditable) return true;
  return false;
}

function setSidebarCollapsed(collapsed) {
  elements.appShell.classList.toggle("sidebar-collapsed", collapsed);
  elements.sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  elements.sidebarToggle.title = collapsed ? "Show library" : "Hide library";
  try {
    if (collapsed) {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    } else {
      localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    }
  } catch (error) {
    // localStorage may be unavailable (private mode, etc.); state still toggles for the session.
  }
}

function restoreSidebarState() {
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch (error) {
    collapsed = false;
  }
  setSidebarCollapsed(collapsed);
}

function applyTheme(name) {
  const theme = THEMES.includes(name) ? name : "";
  let link = document.querySelector("#themeStylesheet");
  if (!theme) {
    if (link) link.remove();
  } else {
    if (!link) {
      link = document.createElement("link");
      link.id = "themeStylesheet";
      link.rel = "stylesheet";
      document.head.append(link);
    }
    link.href = `themes/${theme}.css`;
  }
  try {
    if (theme) {
      localStorage.setItem(THEME_KEY, theme);
    } else {
      localStorage.removeItem(THEME_KEY);
    }
  } catch (error) {
    // localStorage may be unavailable; the theme still applies for this session.
  }
}

function restoreTheme() {
  let theme = "";
  try {
    theme = localStorage.getItem(THEME_KEY) || "";
  } catch (error) {
    theme = "";
  }
  if (!THEMES.includes(theme)) theme = "";
  elements.themeSelect.value = theme;
  applyTheme(theme);
}

function toast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3200);
}
