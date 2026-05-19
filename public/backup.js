import { normalizeSong } from "./song-model.js";

export function createLibraryBackup(songs, deletedSongs = []) {
  return {
    app: "Songbook",
    version: 1,
    exportedAt: new Date().toISOString(),
    songs: songs.map(normalizeSong),
    deletedSongs: deletedSongs.map((song) => ({
      id: String(song.id || ""),
      deletedAt: String(song.deletedAt || new Date().toISOString())
    })).filter((song) => song.id)
  };
}

export function parseLibraryBackup(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const rawSongs = Array.isArray(parsed) ? parsed : parsed?.songs;
  if (!Array.isArray(rawSongs)) {
    throw new Error("Backup file does not contain a songs array.");
  }

  return {
    songs: rawSongs.map(normalizeSong),
    deletedSongs: Array.isArray(parsed?.deletedSongs)
      ? parsed.deletedSongs.map((song) => ({
        id: String(song.id || ""),
        deletedAt: String(song.deletedAt || new Date().toISOString())
      })).filter((song) => song.id)
      : []
  };
}

export function mergeBackupSongs(existingSongs, importedSongs) {
  const byId = new Map(existingSongs.map((song) => [song.id, song]));
  let added = 0;
  let updated = 0;

  for (const imported of importedSongs) {
    const existing = byId.get(imported.id);
    if (!existing) {
      byId.set(imported.id, imported);
      added += 1;
      continue;
    }

    if (new Date(imported.updatedAt) > new Date(existing.updatedAt)) {
      byId.set(imported.id, imported);
      updated += 1;
    }
  }

  return {
    songs: [...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    added,
    updated
  };
}

