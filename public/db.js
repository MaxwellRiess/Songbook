import { normalizeSong } from "./song-model.js";

export const DB_NAME = "songbook";
export const DB_VERSION = 2;
export const SONG_STORE = "songs";
export const DELETED_SONG_STORE = "deletedSongs";

export async function getStoredSongs() {
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

