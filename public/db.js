import { normalizeSong } from "./song-model.js";
import { normalizePlaylist } from "./library-model.js";

export const DB_NAME = "songbook";
export const DB_VERSION = 4;
export const SONG_STORE = "songs";
export const DELETED_SONG_STORE = "deletedSongs";
export const PLAYLIST_STORE = "playlists";
export const DELETED_PLAYLIST_STORE = "deletedPlaylists";

export async function getStoredSongs() {
  const db = await openSongbookDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SONG_STORE, "readonly");
    const request = transaction.objectStore(SONG_STORE).getAll();
    request.onsuccess = () => {
      const songs = (request.result || []).map(normalizeSong);
      songs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      resolve(songs);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function upsertStoredSong(song) {
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

export async function saveStoredSongs(songs) {
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

export async function deleteStoredSong(songId) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(SONG_STORE, "readwrite");
    transaction.objectStore(SONG_STORE).delete(songId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getDeletedSongs() {
  const db = await openSongbookDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DELETED_SONG_STORE, "readonly");
    const request = transaction.objectStore(DELETED_SONG_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function upsertDeletedSong(songId, deletedAt = new Date().toISOString()) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DELETED_SONG_STORE, "readwrite");
    transaction.objectStore(DELETED_SONG_STORE).put({ id: songId, deletedAt });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function removeDeletedSong(songId) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DELETED_SONG_STORE, "readwrite");
    transaction.objectStore(DELETED_SONG_STORE).delete(songId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getStoredPlaylists() {
  const db = await openSongbookDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PLAYLIST_STORE, "readonly");
    const request = transaction.objectStore(PLAYLIST_STORE).getAll();
    request.onsuccess = () => {
      const playlists = (request.result || []).map(normalizePlaylist);
      playlists.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      resolve(playlists);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function upsertStoredPlaylist(playlist) {
  const db = await openSongbookDb();
  const normalized = normalizePlaylist(playlist);
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(PLAYLIST_STORE, "readwrite");
    transaction.objectStore(PLAYLIST_STORE).put(normalized);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  return normalized;
}

export async function saveStoredPlaylists(playlists) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(PLAYLIST_STORE, "readwrite");
    const store = transaction.objectStore(PLAYLIST_STORE);
    store.clear();
    playlists.map(normalizePlaylist).forEach((playlist) => store.put(playlist));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteStoredPlaylist(playlistId) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(PLAYLIST_STORE, "readwrite");
    transaction.objectStore(PLAYLIST_STORE).delete(playlistId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getDeletedPlaylists() {
  const db = await openSongbookDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DELETED_PLAYLIST_STORE, "readonly");
    const request = transaction.objectStore(DELETED_PLAYLIST_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function upsertDeletedPlaylist(playlistId, deletedAt = new Date().toISOString()) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DELETED_PLAYLIST_STORE, "readwrite");
    transaction.objectStore(DELETED_PLAYLIST_STORE).put({ id: playlistId, deletedAt });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function removeDeletedPlaylist(playlistId) {
  const db = await openSongbookDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DELETED_PLAYLIST_STORE, "readwrite");
    transaction.objectStore(DELETED_PLAYLIST_STORE).delete(playlistId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export function openSongbookDb() {
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
