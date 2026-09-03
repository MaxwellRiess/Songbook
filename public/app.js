import { createLibraryBackup, mergeBackupPlaylists, mergeBackupSongs, parseLibraryBackup } from "./backup.js";
import {
  deleteStoredPlaylist,
  deleteStoredSong,
  getDeletedPlaylists,
  getDeletedSongs,
  getStoredPlaylists,
  getStoredSongs,
  removeDeletedPlaylist,
  removeDeletedSong,
  saveStoredPlaylists,
  saveStoredSongs,
  upsertDeletedPlaylist,
  upsertDeletedSong,
  upsertStoredPlaylist,
  upsertStoredSong
} from "./db.js";
import {
  addSongToPlaylist,
  filterSongs,
  groupSongsByArtist,
  movePlaylistSong,
  normalizePlaylist,
  removeSongFromPlaylist,
  songsForPlaylist,
  sortRecentSongs
} from "./library-model.js";
import { buildMetaPills, normalizeSong, toPlainChordSheet } from "./song-model.js";
import { detectSongConflicts, mergePlaylists, mergeSongs } from "./song-sync.js";
import { renderSheet as buildSheetFragment } from "./song-renderer.js";
import { initFollowMode } from "./follow-mode.js";
import { closeChordPopover, initChordPopover } from "./chord-popover.js";
import { collectSongChords, initChordExplorer } from "./chord-explorer.js";
import { initTuner } from "./tuner.js";

const state = {
  songs: [],
  playlists: [],
  selectedId: null,
  editingId: null,
  renamingPlaylistId: null,
  playlistMenuOpen: false,
  libraryView: "recent",
  recentMode: "opened",
  expandedArtistKeys: new Set(),
  expandedPlaylistIds: new Set(),
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
  libraryViewControls: document.querySelector("#libraryViewControls"),
  libraryViewButtons: document.querySelectorAll("[data-library-view]"),
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
  songPanel: document.querySelector(".song-panel"),
  headerPlaylistMenuButton: document.querySelector("#headerPlaylistMenuButton"),
  headerPlaylistMenu: document.querySelector("#headerPlaylistMenu"),
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
  supabaseApiKeyInput: document.querySelector("#supabaseApiKeyInput"),
  syncDialogStatus: document.querySelector("#syncDialogStatus"),
  sendMagicLinkButton: document.querySelector("#sendMagicLinkButton"),
  syncEmailInput: document.querySelector("#syncEmailInput"),
  syncCodeInput: document.querySelector("#syncCodeInput"),
  sendMagicLinkButton: document.querySelector("#sendMagicLinkButton"),
  verifyCodeButton: document.querySelector("#verifyCodeButton"),
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
await loadLibrary();
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
initFollowMode({
  viewer: elements.viewer,
  getSelectedSong,
  onBeforeStart: stopAutoscroll
});
initChordPopover(elements.viewer);
initChordExplorer({
  getSongChords: () => collectSongChords(getSelectedSong(), state.transpose)
});
initTuner();

async function loadLibrary() {
  state.songs = await getStoredSongs();
  state.playlists = await getStoredPlaylists();
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

  elements.libraryViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setLibraryView(button.dataset.libraryView);
    });
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
  elements.headerPlaylistMenuButton.addEventListener("click", () => {
    state.playlistMenuOpen = !state.playlistMenuOpen;
    renderHeaderPlaylistPicker(getSelectedSong());
  });
  elements.syncSettingsButton.addEventListener("click", openSyncDialog);
  elements.syncNowButton.addEventListener("click", syncWithSupabase);
  elements.exportBackupButton.addEventListener("click", exportLibraryBackup);
  elements.importBackupButton.addEventListener("click", () => elements.backupFileInput.click());
  elements.backupFileInput.addEventListener("change", importLibraryBackup);
  elements.closeSyncDialogButton.addEventListener("click", () => elements.syncDialog.close());
  elements.sendMagicLinkButton.addEventListener("click", sendMagicLink);
  elements.verifyCodeButton.addEventListener("click", verifyMagicCode);
  elements.signOutButton.addEventListener("click", signOutOfSupabase);
  elements.closeDialogButton.addEventListener("click", () => elements.dialog.close());
  elements.cancelButton.addEventListener("click", () => elements.dialog.close());

  document.addEventListener("click", (event) => {
    if (!state.playlistMenuOpen) return;
    if (event.target.closest(".header-playlist-picker")) return;
    closeHeaderPlaylistMenu();
  });

  elements.transposeDown.addEventListener("click", () => setTranspose(state.transpose - 1));
  elements.transposeUp.addEventListener("click", () => setTranspose(state.transpose + 1));

  elements.fontSizeDown.addEventListener("click", () => setFontSize(state.fontSize - 1));
  elements.fontSizeUp.addEventListener("click", () => setFontSize(state.fontSize + 1));

  elements.autoscrollToggle.addEventListener("click", () => {
    toggleAutoscroll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.playlistMenuOpen) {
      closeHeaderPlaylistMenu();
      return;
    }
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
    updateCondensedHeader();
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
  elements.libraryViewButtons.forEach((button) => {
    const isActive = button.dataset.libraryView === state.libraryView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  renderLibraryViewControls(songs);
  elements.songList.replaceChildren();

  if (!songs.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = state.songs.length ? "No matches" : "No songs yet";
    elements.songList.append(empty);
    return;
  }

  if (state.libraryView === "playlists") {
    renderPlaylistList(songs);
    return;
  }

  if (state.libraryView === "artists") {
    renderArtistList(songs);
    return;
  }

  renderRecentList(songs);
}

function renderLibraryViewControls(songs) {
  elements.libraryViewControls.replaceChildren();

  if (state.libraryView === "recent") {
    const field = document.createElement("label");
    field.className = "compact-field";
    const caption = document.createElement("span");
    caption.textContent = "Sort";
    const select = document.createElement("select");
    select.value = state.recentMode;
    [
      ["opened", "Recently opened"],
      ["created", "Recently imported"],
      ["updated", "Recently edited"],
      ["title", "Alphabetical"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    select.addEventListener("change", () => {
      state.recentMode = select.value;
      renderSongList();
    });
    field.append(caption, select);
    elements.libraryViewControls.append(field);
    return;
  }

  if (state.libraryView === "playlists") {
    const form = document.createElement("form");
    form.className = "playlist-create";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "New playlist";
    input.setAttribute("aria-label", "New playlist name");
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Add";
    form.append(input, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await createPlaylist(input.value);
      input.value = "";
    });

    const hint = document.createElement("p");
    hint.className = "library-hint";
    const selectedSong = getSelectedSong();
    hint.textContent = selectedSong
      ? `Selected: ${selectedSong.title}`
      : "Select a song, then add it to a playlist.";
    elements.libraryViewControls.append(form, hint);
    return;
  }

  if (state.libraryView === "artists") {
    const hint = document.createElement("p");
    hint.className = "library-hint";
    const groupCount = groupSongsByArtist(songs).length;
    hint.textContent = `${groupCount} ${groupCount === 1 ? "artist" : "artists"}`;
    elements.libraryViewControls.append(hint);
  }
}

function renderRecentList(songs) {
  for (const song of sortRecentSongs(songs, state.recentMode)) {
    elements.songList.append(createSongRow(song));
  }
}

function renderArtistList(songs) {
  const groups = groupSongsByArtist(songs);
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No artists";
    elements.songList.append(empty);
    return;
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "artist-group";

    const header = document.createElement("button");
    header.className = "library-group-header";
    header.type = "button";
    header.dataset.artistKey = group.key;
    header.setAttribute("aria-expanded", String(state.expandedArtistKeys.has(group.key)));
    header.addEventListener("click", () => {
      const anchorTop = header.getBoundingClientRect().top;
      toggleSetValue(state.expandedArtistKeys, group.key);
      renderSongList();
      restoreSongListAnchor(`[data-artist-key="${CSS.escape(group.key)}"]`, anchorTop);
    });

    const label = document.createElement("strong");
    label.textContent = group.name;
    const count = document.createElement("span");
    count.textContent = `${group.songs.length} ${group.songs.length === 1 ? "song" : "songs"}`;
    header.append(label, count);
    section.append(header);

    if (state.expandedArtistKeys.has(group.key)) {
      const songsContainer = document.createElement("div");
      songsContainer.className = "library-group-songs";
      group.songs.forEach((song) => songsContainer.append(createSongRow(song)));
      section.append(songsContainer);
    }

    elements.songList.append(section);
  }
}

function renderPlaylistList(songs) {
  if (!state.playlists.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No playlists yet";
    elements.songList.append(empty);
    return;
  }

  for (const playlist of state.playlists) {
    const section = document.createElement("section");
    section.className = "playlist-group";
    const playlistSongs = songsForPlaylist(playlist, state.songs);
    const visiblePlaylistSongs = playlistSongs.filter((song) => songs.includes(song));
    const isExpanded = state.expandedPlaylistIds.has(playlist.id);
    const isRenaming = state.renamingPlaylistId === playlist.id;
    const selectedSong = getSelectedSong();

    const header = document.createElement("div");
    header.className = `playlist-header${isRenaming ? " renaming" : ""}`;

    if (isRenaming) {
      header.append(createPlaylistRenameForm(playlist));
      section.append(header);
      elements.songList.append(section);
      continue;
    }

    const toggle = document.createElement("button");
    toggle.className = "library-group-header playlist-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.addEventListener("click", () => {
      toggleSetValue(state.expandedPlaylistIds, playlist.id);
      renderSongList();
    });

    const name = document.createElement("strong");
    name.textContent = playlist.name;
    const count = document.createElement("span");
    count.textContent = `${playlistSongs.length} ${playlistSongs.length === 1 ? "song" : "songs"}`;
    toggle.append(name, count);

    const actions = document.createElement("div");
    actions.className = "playlist-actions";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.textContent = "+";
    addButton.title = selectedSong ? `Add "${selectedSong.title}"` : "Select a song first";
    addButton.setAttribute("aria-label", addButton.title);
    addButton.disabled = !selectedSong || playlist.songIds.includes(selectedSong.id);
    addButton.addEventListener("click", async () => {
      if (!selectedSong) return;
      await savePlaylist(addSongToPlaylist(playlist, selectedSong.id));
      state.expandedPlaylistIds.add(playlist.id);
      toast("Added to playlist");
    });

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.textContent = "Rename";
    renameButton.title = `Rename "${playlist.name}"`;
    renameButton.setAttribute("aria-label", renameButton.title);
    renameButton.addEventListener("click", () => {
      state.renamingPlaylistId = playlist.id;
      renderSongList();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "x";
    deleteButton.title = `Delete "${playlist.name}"`;
    deleteButton.setAttribute("aria-label", deleteButton.title);
    deleteButton.addEventListener("click", async () => {
      await deletePlaylist(playlist);
    });
    actions.append(addButton, renameButton, deleteButton);
    header.append(toggle, actions);
    section.append(header);

    if (isExpanded) {
      const songsContainer = document.createElement("div");
      songsContainer.className = "library-group-songs playlist-songs";
      if (!playlistSongs.length) {
        const empty = document.createElement("div");
        empty.className = "list-empty compact-empty";
        empty.textContent = "No songs in this playlist";
        songsContainer.append(empty);
      } else if (!visiblePlaylistSongs.length) {
        const empty = document.createElement("div");
        empty.className = "list-empty compact-empty";
        empty.textContent = "No playlist songs match this search";
        songsContainer.append(empty);
      } else {
        visiblePlaylistSongs.forEach((song) => songsContainer.append(createPlaylistSongRow(playlist, song, playlistSongs)));
      }
      section.append(songsContainer);
    }

    elements.songList.append(section);
  }
}

function createPlaylistRenameForm(playlist) {
  const form = document.createElement("form");
  form.className = "playlist-rename";

  const input = document.createElement("input");
  input.value = playlist.name;
  input.setAttribute("aria-label", `Playlist name for ${playlist.name}`);

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.textContent = "Save";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => {
    state.renamingPlaylistId = null;
    renderSongList();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await renamePlaylist(playlist, input.value);
  });

  form.append(input, saveButton, cancelButton);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return form;
}

function createSongRow(song) {
  const button = document.createElement("button");
  button.className = `song-row${song.id === state.selectedId ? " active" : ""}`;
  button.type = "button";
  button.dataset.songId = song.id;
  button.addEventListener("click", () => selectSong(song.id));

  const title = document.createElement("strong");
  title.textContent = song.title;

  const meta = document.createElement("span");
  meta.textContent = [song.artist, song.key && `Key ${song.key}`].filter(Boolean).join(" · ");

  button.append(title, meta);
  return button;
}

function createPlaylistSongRow(playlist, song, playlistSongs) {
  const row = document.createElement("div");
  row.className = `playlist-song-row${song.id === state.selectedId ? " active" : ""}`;

  const songButton = createSongRow(song);
  songButton.classList.add("playlist-song-button");

  const actions = document.createElement("div");
  actions.className = "playlist-song-actions";
  const index = playlistSongs.findIndex((playlistSong) => playlistSong.id === song.id);
  const upButton = createSmallActionButton("^", "Move up", async () => {
    await savePlaylist(movePlaylistSong(playlist, song.id, -1));
  });
  upButton.disabled = index <= 0;
  const downButton = createSmallActionButton("v", "Move down", async () => {
    await savePlaylist(movePlaylistSong(playlist, song.id, 1));
  });
  downButton.disabled = index >= playlistSongs.length - 1;
  const removeButton = createSmallActionButton("x", "Remove from playlist", async () => {
    await savePlaylist(removeSongFromPlaylist(playlist, song.id));
    toast("Removed from playlist");
  });
  actions.append(upButton, downButton, removeButton);
  row.append(songButton, actions);
  return row;
}

function createSmallActionButton(text, label, handler) {
  const button = document.createElement("button");
  button.className = "small-icon-button";
  button.type = "button";
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", handler);
  return button;
}

async function selectSong(songId) {
  const song = state.songs.find((candidate) => candidate.id === songId);
  if (!song) return;
  const shouldRestoreListPosition = state.libraryView !== "recent" || state.recentMode === "title";
  const selectedRow = shouldRestoreListPosition ? elements.songList.querySelector(`[data-song-id="${CSS.escape(song.id)}"]`) : null;
  const selectedRowTop = selectedRow?.getBoundingClientRect().top ?? null;
  state.selectedId = song.id;
  state.playlistMenuOpen = false;
  state.transpose = 0;
  updateTransposeDisplay();
  stopAutoscroll();
  const openedSong = await upsertStoredSong({ ...song, lastOpenedAt: new Date().toISOString() });
  state.songs = state.songs.map((candidate) => candidate.id === openedSong.id ? openedSong : candidate);
  if (isMobileViewport()) setSidebarCollapsed(true);
  render();
  if (selectedRowTop !== null) {
    restoreSongListAnchor(`[data-song-id="${CSS.escape(song.id)}"]`, selectedRowTop);
  }
}

function setLibraryView(view) {
  if (!["recent", "playlists", "artists"].includes(view) || state.libraryView === view) return;
  state.libraryView = view;
  renderSongList();
}

function toggleSetValue(set, value) {
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }
}

function restoreSongListAnchor(selector, previousTop) {
  const anchor = elements.songList.querySelector(selector);
  if (!anchor) return;
  elements.songList.scrollTop += anchor.getBoundingClientRect().top - previousTop;
}

async function createPlaylist(name) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    toast("Enter a playlist name.", true);
    return;
  }
  await savePlaylist(normalizePlaylist({ name: trimmedName }));
  toast("Created playlist");
}

async function savePlaylist(playlist) {
  const saved = await upsertStoredPlaylist(playlist);
  state.playlists = await getStoredPlaylists();
  state.expandedPlaylistIds.add(saved.id);
  renderSongList();
  renderSelectedSong();
  if (canUseSupabase()) {
    try {
      await syncPlaylistToSupabase(saved);
    } catch (error) {
      updateSyncStatus(error.message || "Playlist sync failed");
      toast("Saved locally. Playlist sync failed.", true);
    }
  }
  return saved;
}

async function deletePlaylist(playlist) {
  const confirmed = window.confirm(`Delete playlist "${playlist.name}"? Songs will stay in your library.`);
  if (!confirmed) return;
  await upsertDeletedPlaylist(playlist.id);
  await deleteStoredPlaylist(playlist.id);
  state.expandedPlaylistIds.delete(playlist.id);
  state.playlists = await getStoredPlaylists();
  await refreshPendingDeleteCount();
  renderSongList();
  renderSelectedSong();

  if (canUseSupabase()) {
    try {
      await deletePlaylistFromSupabase(playlist.id);
      await removeDeletedPlaylist(playlist.id);
      await refreshPendingDeleteCount();
      state.lastSyncedAt = new Date().toISOString();
      updateSyncStatus("Synced");
    } catch (error) {
      updateSyncStatus(error.message || "Playlist sync failed");
      toast("Deleted locally. Remote playlist delete will retry on next sync.", true);
      return;
    }
  }

  toast("Deleted playlist");
}

async function renamePlaylist(playlist, nextName) {
  const trimmedName = String(nextName || "").trim();
  if (!trimmedName) {
    toast("Enter a playlist name.", true);
    return;
  }
  state.renamingPlaylistId = null;
  await savePlaylist({ ...playlist, name: trimmedName, updatedAt: new Date().toISOString() });
  toast("Renamed playlist");
}

function renderSelectedSong() {
  const song = getSelectedSong();
  const hasSong = Boolean(song);
  // A freshly rendered sheet starts scrolled to the top, so expand the header.
  elements.songPanel.classList.remove("is-condensed");
  renderHeaderPlaylistPicker(song);
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

function renderHeaderPlaylistPicker(song) {
  const container = elements.headerPlaylistMenuButton.closest(".header-playlist-picker");
  const availablePlaylists = song
    ? state.playlists.filter((playlist) => !playlist.songIds.includes(song.id))
    : [];
  container.hidden = !song;
  elements.headerPlaylistMenu.replaceChildren();
  elements.headerPlaylistMenu.hidden = !state.playlistMenuOpen || !availablePlaylists.length;
  elements.headerPlaylistMenuButton.setAttribute("aria-expanded", String(state.playlistMenuOpen && availablePlaylists.length > 0));

  if (!song) {
    state.playlistMenuOpen = false;
    elements.headerPlaylistMenuButton.disabled = true;
    elements.headerPlaylistMenuButton.title = "Select a song first";
    return;
  }

  if (!state.playlists.length) {
    state.playlistMenuOpen = false;
    elements.headerPlaylistMenuButton.disabled = true;
    elements.headerPlaylistMenuButton.title = "Create a playlist first";
    return;
  }

  if (!availablePlaylists.length) {
    state.playlistMenuOpen = false;
    elements.headerPlaylistMenuButton.disabled = true;
    elements.headerPlaylistMenuButton.title = "This song is already in every playlist";
    return;
  }

  elements.headerPlaylistMenuButton.disabled = false;
  elements.headerPlaylistMenuButton.title = "Add this song to a playlist";

  for (const playlist of availablePlaylists) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = playlist.name;
    button.addEventListener("click", async () => {
      await addSongToHeaderPlaylist(playlist);
    });
    elements.headerPlaylistMenu.append(button);
  }
}

async function addSongToHeaderPlaylist(playlist) {
  const song = getSelectedSong();
  if (!song || !playlist) return;

  if (playlist.songIds.includes(song.id)) {
    toast("Song is already in that playlist.");
    closeHeaderPlaylistMenu();
    return;
  }

  state.playlistMenuOpen = false;
  await savePlaylist(addSongToPlaylist(playlist, song.id));
  toast(`Added to ${playlist.name}`);
}

function closeHeaderPlaylistMenu() {
  if (!state.playlistMenuOpen) return;
  state.playlistMenuOpen = false;
  renderHeaderPlaylistPicker(getSelectedSong());
}

function renderSheet(song) {
  closeChordPopover();
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
  return elements.viewer;
}

// Collapse the header and toolbar into a slim bar once the sheet is scrolled.
// Hysteresis (condense past 48px, expand under 12px) avoids flicker at the edge.
// The CSS only reacts on mobile, so this is a no-op on desktop.
function updateCondensedHeader() {
  const condensed = elements.songPanel.classList.contains("is-condensed");
  const scrollTop = elements.viewer.scrollTop;
  if (!condensed && scrollTop > 48) {
    elements.songPanel.classList.add("is-condensed");
  } else if (condensed && scrollTop < 12) {
    elements.songPanel.classList.remove("is-condensed");
  }
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

  state.supabaseClient = window.supabase.createClient(state.supabaseConfig.url, state.supabaseConfig.apiKey);
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

// Settings saved before Supabase renamed the anon key still carry `anonKey`.
function readSupabaseConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(SUPABASE_CONFIG_KEY) || "null");
    const apiKey = stored?.apiKey || stored?.anonKey;
    if (!stored?.url || !apiKey) return null;
    return { url: stored.url, apiKey };
  } catch {
    return null;
  }
}

function openSyncDialog() {
  setSyncDialogStatus("");
  elements.supabaseUrlInput.value = state.supabaseConfig?.url || "";
  elements.supabaseApiKeyInput.value = state.supabaseConfig?.apiKey || "";
  elements.syncDialog.showModal();
}

async function saveSupabaseSettings({ closeDialog = true } = {}) {
  const url = elements.supabaseUrlInput.value.trim().replace(/\/+$/, "");
  const apiKey = elements.supabaseApiKeyInput.value.trim();
  if (!url || !apiKey) {
    toast("Supabase URL and publishable key are required.", true);
    return;
  }

  // A secret key bypasses Row Level Security, and anything stored here is
  // readable by anyone using this browser, so refuse it outright.
  if (looksLikeSecretKey(apiKey)) {
    toast("That is a secret key. Use the publishable key, which is safe in a browser.", true);
    return;
  }

  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url, apiKey }));
  state.supabaseConfig = { url, apiKey };
  state.supabaseClient = window.supabase?.createClient(url, apiKey) || null;
  state.supabaseUser = null;
  if (closeDialog) elements.syncDialog.close();
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

// Covers both the `sb_secret_...` keys and the legacy service_role JWTs.
function looksLikeSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;

  try {
    const payload = key.split(".")[1];
    if (!payload) return false;
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded).role === "service_role";
  } catch {
    return false;
  }
}

async function sendMagicLink() {
  if (!state.supabaseClient) {
    await saveSupabaseSettings({ closeDialog: false });
  }
  if (!state.supabaseClient) {
    setSyncDialogStatus("Save your Supabase URL and publishable key first.", true);
    return;
  }

  const email = elements.syncEmailInput.value.trim();
  if (!email) {
    setSyncDialogStatus("Enter an email address.", true);
    return;
  }

  // Sending twice in quick succession trips Supabase's email rate limit, so the
  // button stays disabled until the request comes back.
  elements.sendMagicLinkButton.disabled = true;
  setSyncDialogStatus(`Sending a code to ${email}...`);

  try {
    const { error } = await state.supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href }
    });
    if (error) {
      setSyncDialogStatus(error.message, true);
      toast(error.message, true);
      return;
    }

    setSyncDialogStatus(`Code sent to ${email}. Check your inbox and spam folder, then enter the 6-digit code below.`);
    toast("Code sent");
  } catch (error) {
    setSyncDialogStatus(error.message || "Could not reach Supabase.", true);
  } finally {
    elements.sendMagicLinkButton.disabled = false;
  }
}

async function verifyMagicCode() {
  if (!state.supabaseClient) {
    setSyncDialogStatus("Save your Supabase settings first.", true);
    return;
  }

  const email = elements.syncEmailInput.value.trim();
  const token = elements.syncCodeInput.value.trim();
  if (!email || !token) {
    setSyncDialogStatus("Enter your email and the code from the email.", true);
    return;
  }

  setSyncDialogStatus("Checking the code...");

  // Verifying the code creates the session directly in this context, so an
  // installed PWA signs in without depending on the email link opening here.
  const { error } = await state.supabaseClient.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    setSyncDialogStatus(error.message, true);
    toast(error.message, true);
    return;
  }

  elements.syncCodeInput.value = "";
  setSyncDialogStatus(`Signed in as ${email}. Syncing your library.`);
  // onAuthStateChange picks up the new session and triggers the sync.
  toast("Signed in");
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
    await flushPendingPlaylistDeletesToSupabase();
    const deletedSongs = await getDeletedSongs();
    const deletedPlaylists = await getDeletedPlaylists();
    const { data, error } = await state.supabaseClient
      .from("songs")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const remoteSongs = (data || []).map(songFromSupabaseRow);
    const conflicts = detectSongConflicts(state.songs, remoteSongs, deletedSongs);
    const mergedSongs = preserveLocalOpenTimes(mergeSongs(state.songs, remoteSongs, deletedSongs), state.songs);
    await saveLocalSongs(mergedSongs);
    state.songs = mergedSongs;
    state.selectedId = mergedSongs.some((song) => song.id === state.selectedId) ? state.selectedId : mergedSongs[0]?.id || null;

    if (mergedSongs.length) {
      const rows = mergedSongs.map(songToSupabaseRow);
      const { error: upsertError } = await state.supabaseClient.from("songs").upsert(rows, { onConflict: "id" });
      if (upsertError) throw upsertError;
    }

    const remotePlaylists = await getPlaylistsFromSupabase();
    const mergedPlaylists = mergePlaylists(state.playlists, remotePlaylists, deletedPlaylists);
    await saveStoredPlaylists(mergedPlaylists);
    state.playlists = mergedPlaylists;

    if (mergedPlaylists.length) {
      const playlistRows = mergedPlaylists.map(playlistToSupabaseRow);
      const { error: playlistUpsertError } = await state.supabaseClient.from("playlists").upsert(playlistRows, { onConflict: "id" });
      if (playlistUpsertError) throw formatPlaylistSyncError(playlistUpsertError);
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

async function syncPlaylistToSupabase(playlist) {
  if (!canUseSupabase()) return;
  const { error } = await state.supabaseClient.from("playlists").upsert(playlistToSupabaseRow(playlist), { onConflict: "id" });
  if (error) throw formatPlaylistSyncError(error);
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

async function deletePlaylistFromSupabase(playlistId) {
  await deletePlaylistsFromSupabase([playlistId]);
}

async function deletePlaylistsFromSupabase(playlistIds) {
  if (!canUseSupabase() || !playlistIds.length) return;
  const { error } = await state.supabaseClient.from("playlists").delete().in("id", playlistIds);
  if (error) throw formatPlaylistSyncError(error);
}

async function flushPendingDeletesToSupabase() {
  const deletedSongs = await getDeletedSongs();
  if (!deletedSongs.length) return;

  await deleteSongsFromSupabase(deletedSongs.map((song) => song.id));
  await Promise.all(deletedSongs.map((song) => removeDeletedSong(song.id)));
}

async function flushPendingPlaylistDeletesToSupabase() {
  const deletedPlaylists = await getDeletedPlaylists();
  if (!deletedPlaylists.length) return;

  await deletePlaylistsFromSupabase(deletedPlaylists.map((playlist) => playlist.id));
  await Promise.all(deletedPlaylists.map((playlist) => removeDeletedPlaylist(playlist.id)));
}

function canUseSupabase() {
  return Boolean(state.supabaseClient && state.supabaseUser);
}

async function refreshPendingDeleteCount() {
  const [deletedSongs, deletedPlaylists] = await Promise.all([getDeletedSongs(), getDeletedPlaylists()]);
  state.pendingDeleteCount = deletedSongs.length + deletedPlaylists.length;
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

function preserveLocalOpenTimes(songs, localSongs) {
  const openedById = new Map(localSongs.map((song) => [song.id, song.lastOpenedAt]).filter(([, lastOpenedAt]) => lastOpenedAt));
  return songs.map((song) => ({
    ...song,
    lastOpenedAt: openedById.get(song.id) || song.lastOpenedAt || ""
  }));
}

async function getPlaylistsFromSupabase() {
  const { data, error } = await state.supabaseClient
    .from("playlists")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw formatPlaylistSyncError(error);
  return (data || []).map(playlistFromSupabaseRow);
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

function playlistToSupabaseRow(playlist) {
  return {
    id: playlist.id,
    user_id: state.supabaseUser.id,
    name: playlist.name,
    description: playlist.description || "",
    song_ids: playlist.songIds || [],
    created_at: playlist.createdAt,
    updated_at: playlist.updatedAt
  };
}

function playlistFromSupabaseRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    songIds: row.song_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatPlaylistSyncError(error) {
  if (isMissingPlaylistTableError(error)) {
    return new Error("Playlist sync needs the latest Supabase schema. Run supabase/schema.sql in your Supabase project.");
  }
  if (isPlaylistIdTypeError(error)) {
    return new Error("Playlist sync needs the latest Supabase schema. Run supabase/schema.sql again so playlist IDs are stored as text.");
  }
  return error;
}

function isMissingPlaylistTableError(error) {
  const text = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  return /playlists/i.test(text) && /(does not exist|not found|schema cache|PGRST205|42P01)/i.test(text);
}

function isPlaylistIdTypeError(error) {
  const text = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  return /(22P02|invalid input syntax for type uuid)/i.test(text);
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
    await removeSongFromAllPlaylists(song.id);
    state.songs = await getStoredSongs();
    state.playlists = await getStoredPlaylists();
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

async function removeSongFromAllPlaylists(songId) {
  const updatedPlaylists = state.playlists.map((playlist) => removeSongFromPlaylist(playlist, songId));
  const changedPlaylists = updatedPlaylists.filter((playlist, index) => playlist.songIds.length !== state.playlists[index].songIds.length);
  if (!changedPlaylists.length) return;
  await Promise.all(changedPlaylists.map(upsertStoredPlaylist));
  if (canUseSupabase()) {
    try {
      await Promise.all(changedPlaylists.map(syncPlaylistToSupabase));
    } catch (error) {
      updateSyncStatus(error.message || "Playlist sync failed");
      toast("Updated playlists locally. Playlist sync failed.", true);
    }
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
    const backup = createLibraryBackup(state.songs, deletedSongs, state.playlists);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `songbook-backup-${date}.json`;
    const backupText = `${JSON.stringify(backup, null, 2)}\n`;

    if (await trySaveBackupWithPicker(filename, backupText)) {
      toast(`Saved backup with ${backup.songs.length} songs and ${backup.playlists.length} playlists`);
      return;
    }

    downloadBackup(filename, backupText);
    toast(`Downloaded backup with ${backup.songs.length} songs and ${backup.playlists.length} playlists`);
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
    const confirmed = window.confirm(`Import ${backup.songs.length} song${backup.songs.length === 1 ? "" : "s"} and ${backup.playlists.length} playlist${backup.playlists.length === 1 ? "" : "s"} from this backup? Newer versions will replace older local copies.`);
    if (!confirmed) return;

    const result = mergeBackupSongs(state.songs, backup.songs);
    const playlistResult = mergeBackupPlaylists(state.playlists, backup.playlists);
    const deletedIds = new Set(backup.deletedSongs.map((song) => song.id));
    await saveStoredSongs(result.songs.filter((song) => !deletedIds.has(song.id)));
    await saveStoredPlaylists(removeDeletedSongsFromPlaylists(playlistResult.playlists, deletedIds));
    await Promise.all(backup.deletedSongs.map((song) => upsertDeletedSong(song.id, song.deletedAt)));
    state.songs = await getStoredSongs();
    state.playlists = await getStoredPlaylists();
    state.selectedId = state.songs.some((song) => song.id === state.selectedId) ? state.selectedId : state.songs[0]?.id || null;
    await refreshPendingDeleteCount();
    render();

    if (canUseSupabase()) {
      await syncWithSupabase();
    }

    toast(`Imported ${result.added} new songs, ${result.updated} updated songs, and ${playlistResult.added + playlistResult.updated} playlists`);
  } catch (error) {
    toast(error.message || "Could not import backup.", true);
  }
}

function removeDeletedSongsFromPlaylists(playlists, deletedIds) {
  if (!deletedIds.size) return playlists;
  return playlists.map((playlist) => ({
    ...playlist,
    songIds: playlist.songIds.filter((songId) => !deletedIds.has(songId))
  }));
}

function getFilteredSongs() {
  return filterSongs(state.songs, state.query);
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
  moveToastAboveOpenDialog();
  // Flush layout so the fade starts from opacity 0. requestAnimationFrame would
  // never fire if the tab is in the background, leaving the toast stuck hidden.
  void elements.toast.offsetWidth;
  elements.toast.classList.add("visible");
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3200);
}

/* A modal <dialog> is promoted to the browser's top layer, which paints above
   every ordinary element whatever its z-index, so a toast sitting in the body
   is hidden behind an open dialog. Moving it inside the dialog puts it in the
   same layer. It stays position:fixed, so the corner placement is unchanged. */
function moveToastAboveOpenDialog() {
  const host = document.querySelector("dialog:modal") || document.body;
  if (elements.toast.parentElement !== host) host.append(elements.toast);
}

// Dialog messages persist until the next step, unlike the toast which times out.
function setSyncDialogStatus(message, isError = false) {
  elements.syncDialogStatus.textContent = message;
  elements.syncDialogStatus.classList.toggle("error", isError);
}
