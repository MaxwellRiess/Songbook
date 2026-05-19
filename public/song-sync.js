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

