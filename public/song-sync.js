import { normalizePlaylist } from "./library-model.js";

export function mergeSongs(localSongs, remoteSongs, deletedSongs = []) {
  const deletedIds = new Set(deletedSongs.map((song) => song.id).filter(Boolean));
  const byId = new Map();

  for (const song of [...remoteSongs, ...localSongs]) {
    if (deletedIds.has(song.id)) continue;

    const existing = byId.get(song.id);
    if (!existing || new Date(song.updatedAt) > new Date(existing.updatedAt)) {
      byId.set(song.id, song);
    }
  }

  return [...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function mergePlaylists(localPlaylists, remotePlaylists, deletedPlaylists = []) {
  const deletedIds = new Set(deletedPlaylists.map((playlist) => playlist.id).filter(Boolean));
  const byId = new Map();

  for (const playlist of [...remotePlaylists, ...localPlaylists].map(normalizePlaylist)) {
    if (deletedIds.has(playlist.id)) continue;

    const existing = byId.get(playlist.id);
    if (!existing || new Date(playlist.updatedAt) > new Date(existing.updatedAt)) {
      byId.set(playlist.id, playlist);
    }
  }

  return [...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function detectSongConflicts(localSongs, remoteSongs, deletedSongs = []) {
  const deletedIds = new Set(deletedSongs.map((song) => song.id).filter(Boolean));
  const remoteById = new Map(remoteSongs.map((song) => [song.id, song]));
  const conflicts = [];

  for (const local of localSongs) {
    if (deletedIds.has(local.id)) continue;
    const remote = remoteById.get(local.id);
    if (!remote) continue;
    if (!songsDiffer(local, remote)) continue;

    conflicts.push({
      id: local.id,
      title: newerSong(local, remote).title,
      localUpdatedAt: local.updatedAt,
      remoteUpdatedAt: remote.updatedAt,
      winningSource: new Date(local.updatedAt) >= new Date(remote.updatedAt) ? "local" : "remote"
    });
  }

  return conflicts;
}

function songsDiffer(a, b) {
  return ["title", "artist", "key", "capo", "tuning", "sourceUrl", "rawContent"].some((field) => String(a[field] || "") !== String(b[field] || "")) ||
    tagsKey(a.tags) !== tagsKey(b.tags);
}

function tagsKey(tags) {
  return Array.isArray(tags) ? tags.map(String).sort().join("\u0000") : "";
}

function newerSong(a, b) {
  return new Date(a.updatedAt) >= new Date(b.updatedAt) ? a : b;
}
