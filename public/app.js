import { createLibraryBackup, mergeBackupSongs, parseLibraryBackup } from "./backup.js";
import {
  deleteStoredSong,
  getDeletedSongs,
  getStoredSongs,
  removeDeletedSong,
  saveStoredSongs,
  upsertDeletedSong,
  upsertStoredSong
} from "./db.js";
import { buildMetaPills, normalizeSong, toPlainChordSheet } from "./song-model.js";
import { detectSongConflicts, mergeSongs } from "./song-sync.js";
import { renderSheet as buildSheetFragment } from "./song-renderer.js";

const state = {
  songs: [],
  selectedId: null,
  editingId: null,
  transpose: 0,
  fontSize: 16,
  autoscrollActive: false,
  autoscrollSpeed: 32,
  autoscrollFrameId: null,
  autoscrollLastTime: null,
  autoscrollRemainder: 0,
  supabaseClient: null,
  supabaseUser: null,
  supabaseConfig: null,
  syncBusy: false,
  lastSyncedAt: "",
  pendingDeleteCount: 0,
  syncConflictCount: 0,
  query: ""
};

const elements = {
  appShell: document.querySelector("#appShell"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  songCount: document.querySelector("#songCount"),
  songList: document.querySelector("#songList"),
  searchInput: document.querySelector("#searchInput"),
  syncStatus: document.querySelector("#syncStatus"),
  syncDetails: document.querySelector("#syncDetails"),
  syncNowButton: document.querySelector("#syncNowButton"),
  syncSettingsButton: document.querySelector("#syncSettingsButton"),
  exportBackupButton: document.querySelector("#exportBackupButton"),
  importBackupButton: document.querySelector("#importBackupButton"),
  backupFileInput: document.querySelector("#backupFileInput"),
  newSongButton: document.querySelector("#newSongButton"),
  artistMeta: document.querySelector("#artistMeta"),
  songTitle: document.querySelector("#songTitle"),
  songMeta: document.querySelector("#songMeta"),
  viewer: document.querySelector("#viewer"),
  editButton: document.querySelector("#editButton"),
  deleteButton: document.querySelector("#deleteButton"),
  copyButton: document.querySelector("#copyButton"),
  transposeValue: document.querySelector("#transposeValue"),
  transposeDown: document.querySelector("#transposeDown"),
  transposeUp: document.querySelector("#transposeUp"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  fontSizeDown: document.querySelector("#fontSizeDown"),
  fontSizeUp: document.querySelector("#fontSizeUp"),
  themeSelect: document.querySelector("#themeSelect"),
  sidebarScrim: document.querySelector("#sidebarScrim"),
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
const DEFAULT_THEME = "stage";
const THEMES = ["vintage", "zine", "analog", "stage", "editorial"];
const AUTOSCROLL_MIN_SPEED = 8;
const AUTOSCROLL_MAX_SPEED = 100;
const AUTOSCROLL_CURVE = 2;
const FONT_SIZE_MIN = 13;
const FONT_SIZE_MAX = 24;
const TRANSPOSE_MIN = -6;
const TRANSPOSE_MAX = 6;

await initializeSupabase();
await loadSongs();
await refreshPendingDeleteCount();
const clippedSong = await consumeClipImportFromLocation();
let clippedSongSyncFailed = false;
if (clippedSong) {
  state.songs = await getStoredSongs();
  state.selectedId = clippedSong.id;
  try {
    await syncSongToSupabase(clippedSong);
  } catch (error) {
    clippedSongSyncFailed = true;
    updateSyncStatus(error.message || "Sync failed");
  }
}
restoreSidebarState();
restoreTheme();
bindEvents();
updateTransposeDisplay();
updateFontSizeDisplay();
updateAutoscrollControls();
render();
if (clippedSong) {
  toast(clippedSongSyncFailed ? "Clipped song imported locally. Sync failed." : "Clipped song imported", clippedSongSyncFailed);
}
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

  elements.sidebarScrim.addEventListener("click", () => setSidebarCollapsed(true));

  elements.themeSelect.addEventListener("change", () => {
    applyTheme(elements.themeSelect.value);
  });

  elements.newSongButton.addEventListener("click", () => openSongDialog());
  elements.editButton.addEventListener("click", () => openSongDialog(getSelectedSong()));
  elements.deleteButton.addEventListener("click", deleteSelectedSong);
  elements.copyButton.addEventListener("click", copySelectedSong);
  elements.syncSettingsButton.addEventListener("click", openSyncDialog);
  elements.syncNowButton.addEventListener("click", syncWithSupabase);
  elements.exportBackupButton.addEventListener("click", exportLibraryBackup);
  elements.importBackupButton.addEventListener("click", () => elements.backupFileInput.click());
  elements.backupFileInput.addEventListener("change", importLibraryBackup);
  elements.closeSyncDialogButton.addEventListener("click", () => elements.syncDialog.close());
  elements.sendMagicLinkButton.addEventListener("click", sendMagicLink);
  elements.signOutButton.addEventListener("click", signOutOfSupabase);
  elements.closeDialogButton.addEventListener("click", () => elements.dialog.close());
  elements.cancelButton.addEventListener("click", () => elements.dialog.close());

  elements.transposeDown.addEventListener("click", () => setTranspose(state.transpose - 1));
  elements.transposeUp.addEventListener("click", () => setTranspose(state.transpose + 1));

  elements.fontSizeDown.addEventListener("click", () => setFontSize(state.fontSize - 1));
  elements.fontSizeUp.addEventListener("click", () => setFontSize(state.fontSize + 1));

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

  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    if (elements.dialog?.open || elements.syncDialog?.open) return;
    if (!getSelectedSong()) return;
    event.preventDefault();
    nudgeAutoscrollSpeed(event.key === "ArrowRight" ? 1 : -1);
  });

  elements.autoscrollSpeed.addEventListener("input", () => {
    state.autoscrollSpeed = autoscrollSpeedFromSlider(Number(elements.autoscrollSpeed.value));
    elements.autoscrollSpeedValue.value = `${state.autoscrollSpeed} px/s`;
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
    let syncFailed = false;
    try {
      await syncSongToSupabase(song);
    } catch (error) {
      syncFailed = true;
      updateSyncStatus(error.message || "Sync failed");
    }
    render();
    toast(syncFailed ? "Clipped song imported locally. Sync failed." : "Clipped song imported", syncFailed);
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
      updateTransposeDisplay();
      stopAutoscroll();
      if (isMobileViewport()) setSidebarCollapsed(true);
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
  elements.viewer.replaceChildren(buildSheetFragment(song, state.transpose));
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
  elements.autoscrollSpeed.value = String(autoscrollSliderFromSpeed(state.autoscrollSpeed));
  elements.autoscrollSpeedValue.value = `${state.autoscrollSpeed} px/s`;
  elements.autoscrollControls.classList.toggle("is-active", state.autoscrollActive);
}

// Slider position (0-100) maps to speed on an eased curve so the slow end,
// where reading speeds live, gets most of the travel; the fast end caps at 100 px/s.
function autoscrollSpeedFromSlider(position) {
  const t = Math.min(Math.max(position / 100, 0), 1);
  const range = AUTOSCROLL_MAX_SPEED - AUTOSCROLL_MIN_SPEED;
  return Math.round(AUTOSCROLL_MIN_SPEED + range * Math.pow(t, AUTOSCROLL_CURVE));
}

function autoscrollSliderFromSpeed(speed) {
  const clamped = Math.min(Math.max(speed, AUTOSCROLL_MIN_SPEED), AUTOSCROLL_MAX_SPEED);
  const t = (clamped - AUTOSCROLL_MIN_SPEED) / (AUTOSCROLL_MAX_SPEED - AUTOSCROLL_MIN_SPEED);
  return Math.round(Math.pow(t, 1 / AUTOSCROLL_CURVE) * 100);
}

function setTranspose(value) {
  const clamped = Math.min(Math.max(value, TRANSPOSE_MIN), TRANSPOSE_MAX);
  if (clamped === state.transpose) return;
  state.transpose = clamped;
  updateTransposeDisplay();
  renderSelectedSong();
}

function updateTransposeDisplay() {
  elements.transposeValue.textContent = state.transpose > 0 ? `+${state.transpose}` : String(state.transpose);
  elements.transposeDown.disabled = state.transpose <= TRANSPOSE_MIN;
  elements.transposeUp.disabled = state.transpose >= TRANSPOSE_MAX;
}

function setFontSize(value) {
  const clamped = Math.min(Math.max(value, FONT_SIZE_MIN), FONT_SIZE_MAX);
  if (clamped === state.fontSize) return;
  state.fontSize = clamped;
  updateFontSizeDisplay();
  elements.viewer.style.setProperty("--sheet-font-size", `${state.fontSize}px`);
}

function updateFontSizeDisplay() {
  elements.fontSizeValue.textContent = String(state.fontSize);
  elements.fontSizeDown.disabled = state.fontSize <= FONT_SIZE_MIN;
  elements.fontSizeUp.disabled = state.fontSize >= FONT_SIZE_MAX;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function hasLocalApi() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
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
    await flushPendingDeletesToSupabase();
    const deletedSongs = await getDeletedSongs();
    const { data, error } = await state.supabaseClient
      .from("songs")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const remoteSongs = (data || []).map(songFromSupabaseRow);
    const conflicts = detectSongConflicts(state.songs, remoteSongs, deletedSongs);
    const mergedSongs = mergeSongs(state.songs, remoteSongs, deletedSongs);
    await saveLocalSongs(mergedSongs);
    state.songs = mergedSongs;
    state.selectedId = mergedSongs.some((song) => song.id === state.selectedId) ? state.selectedId : mergedSongs[0]?.id || null;

    if (mergedSongs.length) {
      const rows = mergedSongs.map(songToSupabaseRow);
      const { error: upsertError } = await state.supabaseClient.from("songs").upsert(rows, { onConflict: "id" });
      if (upsertError) throw upsertError;
    }

    state.lastSyncedAt = new Date().toISOString();
    state.syncConflictCount = conflicts.length;
    await refreshPendingDeleteCount();
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
  if (error) throw error;
  state.lastSyncedAt = new Date().toISOString();
  updateSyncStatus("Synced");
}

async function deleteSongFromSupabase(songId) {
  await deleteSongsFromSupabase([songId]);
}

async function deleteSongsFromSupabase(songIds) {
  if (!canUseSupabase() || !songIds.length) return;
  const { error } = await state.supabaseClient.from("songs").delete().in("id", songIds);
  if (error) throw error;
}

async function flushPendingDeletesToSupabase() {
  const deletedSongs = await getDeletedSongs();
  if (!deletedSongs.length) return;

  await deleteSongsFromSupabase(deletedSongs.map((song) => song.id));
  await Promise.all(deletedSongs.map((song) => removeDeletedSong(song.id)));
}

function canUseSupabase() {
  return Boolean(state.supabaseClient && state.supabaseUser);
}

async function refreshPendingDeleteCount() {
  state.pendingDeleteCount = (await getDeletedSongs()).length;
  updateSyncStatus();
}

function updateSyncStatus(message = "") {
  if (!state.supabaseConfig) {
    elements.syncStatus.textContent = "Local only";
    elements.syncDetails.textContent = state.pendingDeleteCount
      ? `${state.pendingDeleteCount} deletion${state.pendingDeleteCount === 1 ? "" : "s"} will sync after sign-in.`
      : "Changes stay on this device.";
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

  elements.syncDetails.textContent = buildSyncDetails();
  elements.syncNowButton.disabled = !canUseSupabase() || state.syncBusy;
}

function buildSyncDetails() {
  const parts = [];
  if (state.lastSyncedAt) {
    parts.push(`Last synced ${formatSyncTime(state.lastSyncedAt)}`);
  } else if (state.supabaseUser) {
    parts.push("Ready to sync");
  } else {
    parts.push("Sign in to sync across devices");
  }

  if (state.pendingDeleteCount) {
    parts.push(`${state.pendingDeleteCount} pending delete${state.pendingDeleteCount === 1 ? "" : "s"}`);
  }

  if (state.syncConflictCount) {
    parts.push(`${state.syncConflictCount} possible conflict${state.syncConflictCount === 1 ? "" : "s"} resolved by newest edit`);
  }

  return parts.join(" · ");
}

function formatSyncTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

async function saveLocalSongs(songs) {
  await saveStoredSongs(songs);
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
  try {
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

    const existing = state.editingId ? state.songs.find((song) => song.id === state.editingId) : null;
    if (state.editingId && !existing) {
      toast("Could not find the song being edited.", true);
      return;
    }

    const song = await upsertStoredSong(normalizeSong({ ...existing, ...payload, updatedAt: new Date().toISOString() }));
    state.songs = await getStoredSongs();
    state.selectedId = song.id;

    let syncFailed = false;
    try {
      await syncSongToSupabase(song);
    } catch (error) {
      syncFailed = true;
      updateSyncStatus(error.message || "Sync failed");
    }

    elements.dialog.close();
    toast(syncFailed ? "Saved locally. Sync failed." : "Saved song", syncFailed);
    render();
  } catch (error) {
    toast(error.message || "Could not save song.", true);
  }
}

async function deleteSelectedSong() {
  const song = getSelectedSong();
  if (!song) return;
  const confirmed = window.confirm(`Delete "${song.title}"?`);
  if (!confirmed) return;

  stopAutoscroll();

  try {
    await upsertDeletedSong(song.id);
    await deleteStoredSong(song.id);
    state.songs = await getStoredSongs();
    state.selectedId = state.songs[0]?.id || null;
    await refreshPendingDeleteCount();
    render();
  } catch (error) {
    toast(error.message || "Could not delete song.", true);
    return;
  }

  if (!canUseSupabase()) {
    toast("Deleted song");
    return;
  }

  try {
    await deleteSongFromSupabase(song.id);
    await removeDeletedSong(song.id);
    await refreshPendingDeleteCount();
    state.lastSyncedAt = new Date().toISOString();
    updateSyncStatus("Synced");
    toast("Deleted song");
  } catch (error) {
    updateSyncStatus(error.message || "Sync failed");
    toast("Deleted locally. Remote delete will retry on next sync.", true);
  }
}

async function copySelectedSong() {
  const song = getSelectedSong();
  if (!song) return;
  await navigator.clipboard.writeText(toPlainChordSheet(song));
  toast("Copied song");
}

async function exportLibraryBackup() {
  try {
    const deletedSongs = await getDeletedSongs();
    const backup = createLibraryBackup(state.songs, deletedSongs);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `songbook-backup-${date}.json`;
    const backupText = `${JSON.stringify(backup, null, 2)}\n`;

    if (await trySaveBackupWithPicker(filename, backupText)) {
      toast(`Saved backup with ${backup.songs.length} songs`);
      return;
    }

    downloadBackup(filename, backupText);
    toast(`Downloaded backup with ${backup.songs.length} songs`);
  } catch (error) {
    if (error?.name === "AbortError") {
      toast("Export cancelled");
      return;
    }
    toast(error.message || "Could not export backup.", true);
  }
}

async function trySaveBackupWithPicker(filename, backupText) {
  if (!("showSaveFilePicker" in window)) return false;

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: "Songbook backup",
        accept: { "application/json": [".json"] }
      }]
    });
    const writable = await handle.createWritable();
    await writable.write(backupText);
    await writable.close();
    return true;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return false;
  }
}

function downloadBackup(filename, backupText) {
  const blob = new Blob([backupText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importLibraryBackup(event) {
  const file = event.target.files?.[0];
  elements.backupFileInput.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const backup = parseLibraryBackup(text);
    const confirmed = window.confirm(`Import ${backup.songs.length} song${backup.songs.length === 1 ? "" : "s"} from this backup? Newer versions will replace older local copies.`);
    if (!confirmed) return;

    const result = mergeBackupSongs(state.songs, backup.songs);
    const deletedIds = new Set(backup.deletedSongs.map((song) => song.id));
    await saveStoredSongs(result.songs.filter((song) => !deletedIds.has(song.id)));
    await Promise.all(backup.deletedSongs.map((song) => upsertDeletedSong(song.id, song.deletedAt)));
    state.songs = await getStoredSongs();
    state.selectedId = state.songs.some((song) => song.id === state.selectedId) ? state.selectedId : state.songs[0]?.id || null;
    await refreshPendingDeleteCount();
    render();

    if (canUseSupabase()) {
      await syncWithSupabase();
    }

    toast(`Imported ${result.added} new and ${result.updated} updated song${result.added + result.updated === 1 ? "" : "s"}`);
  } catch (error) {
    toast(error.message || "Could not import backup.", true);
  }
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

function toggleAutoscroll() {
  if (state.autoscrollActive) {
    stopAutoscroll();
  } else {
    startAutoscroll();
  }
}

// Move the speed slider by a few steps (left/right arrow keys), mirroring
// what the slider's own "input" handler does.
function nudgeAutoscrollSpeed(direction) {
  const slider = elements.autoscrollSpeed;
  const step = 5;
  const min = Number(slider.min) || 0;
  const max = Number(slider.max) || 100;
  const current = Number(slider.value);
  const next = Math.min(max, Math.max(min, current + direction * step));
  if (next === current) return;
  slider.value = String(next);
  state.autoscrollSpeed = autoscrollSpeedFromSlider(next);
  elements.autoscrollSpeedValue.value = `${state.autoscrollSpeed} px/s`;
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
  // On mobile the library is a slide-in overlay; start it dismissed so the song shows first.
  if (isMobileViewport()) collapsed = true;
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
  let theme = DEFAULT_THEME;
  try {
    theme = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
  } catch (error) {
    theme = DEFAULT_THEME;
  }
  if (!THEMES.includes(theme)) theme = DEFAULT_THEME;
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
