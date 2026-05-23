export const RECENT_MODES = ["opened", "created", "updated", "title"];

export function normalizePlaylist(input = {}) {
  const timestamp = new Date().toISOString();
  const seenSongIds = new Set();
  const songIds = Array.isArray(input.songIds)
    ? input.songIds.map(String).filter((songId) => {
      if (!songId || seenSongIds.has(songId)) return false;
      seenSongIds.add(songId);
      return true;
    })
    : [];

  return {
    id: input.id || createId(),
    name: String(input.name || "Untitled playlist").trim() || "Untitled playlist",
    description: String(input.description || "").trim(),
    songIds,
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp
  };
}

export function filterSongs(songs, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return songs;
  return songs.filter((song) => {
    const haystack = [song.title, song.artist, song.key, song.rawContent, ...(song.tags || [])].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function sortRecentSongs(songs, mode = "opened") {
  const recentMode = RECENT_MODES.includes(mode) ? mode : "opened";
  return [...songs].sort((a, b) => {
    if (recentMode === "title") return compareSongsByTitle(a, b);
    const dateDelta = dateValue(getRecentDate(b, recentMode)) - dateValue(getRecentDate(a, recentMode));
    if (dateDelta !== 0) return dateDelta;
    return compareSongsByTitle(a, b);
  });
}

export function groupSongsByArtist(songs) {
  const byArtist = new Map();
  for (const song of songs) {
    const displayName = String(song.artist || "Unknown artist").trim() || "Unknown artist";
    const key = normalizeArtistKey(displayName);
    const group = byArtist.get(key) || {
      key,
      name: displayName,
      songs: []
    };
    group.songs.push(song);
    byArtist.set(key, group);
  }

  return [...byArtist.values()]
    .map((group) => ({
      ...group,
      songs: [...group.songs].sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function songsForPlaylist(playlist, songs) {
  const songsById = new Map(songs.map((song) => [song.id, song]));
  return (playlist.songIds || []).map((songId) => songsById.get(songId)).filter(Boolean);
}

export function addSongToPlaylist(playlist, songId) {
  const normalized = normalizePlaylist(playlist);
  const id = String(songId || "");
  if (!id || normalized.songIds.includes(id)) return normalized;
  return {
    ...normalized,
    songIds: [...normalized.songIds, id],
    updatedAt: new Date().toISOString()
  };
}

export function removeSongFromPlaylist(playlist, songId) {
  const normalized = normalizePlaylist(playlist);
  const id = String(songId || "");
  return {
    ...normalized,
    songIds: normalized.songIds.filter((playlistSongId) => playlistSongId !== id),
    updatedAt: new Date().toISOString()
  };
}

export function movePlaylistSong(playlist, songId, direction) {
  const normalized = normalizePlaylist(playlist);
  const id = String(songId || "");
  const index = normalized.songIds.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= normalized.songIds.length) return normalized;

  const songIds = [...normalized.songIds];
  const [moved] = songIds.splice(index, 1);
  songIds.splice(nextIndex, 0, moved);
  return {
    ...normalized,
    songIds,
    updatedAt: new Date().toISOString()
  };
}

function getRecentDate(song, mode) {
  if (mode === "created") return song.createdAt;
  if (mode === "updated") return song.updatedAt;
  return song.lastOpenedAt || song.updatedAt || song.createdAt;
}

function normalizeArtistKey(value) {
  return String(value || "Unknown artist").trim().replace(/\s+/g, " ").toLowerCase() || "unknown artist";
}

function dateValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareSongsByTitle(a, b) {
  const titleDelta = String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
  if (titleDelta !== 0) return titleDelta;
  return String(a.artist || "").localeCompare(String(b.artist || ""), undefined, { sensitivity: "base" });
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `playlist-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
