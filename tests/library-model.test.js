import assert from "node:assert/strict";
import test from "node:test";
import {
  addSongToPlaylist,
  groupSongsByArtist,
  movePlaylistSong,
  normalizePlaylist,
  removeSongFromPlaylist,
  sortRecentSongs
} from "../public/library-model.js";

test("sortRecentSongs supports opened, imported, edited, and alphabetical ordering", () => {
  const songs = [
    {
      id: "old-opened",
      title: "B",
      createdAt: "2026-05-17T09:00:00.000Z",
      updatedAt: "2026-05-18T09:00:00.000Z",
      lastOpenedAt: "2026-05-18T10:00:00.000Z"
    },
    {
      id: "new-opened",
      title: "A",
      createdAt: "2026-05-16T09:00:00.000Z",
      updatedAt: "2026-05-17T09:00:00.000Z",
      lastOpenedAt: "2026-05-19T10:00:00.000Z"
    },
    {
      id: "new-created",
      title: "C",
      createdAt: "2026-05-19T09:00:00.000Z",
      updatedAt: "2026-05-16T09:00:00.000Z",
      lastOpenedAt: ""
    }
  ];

  assert.deepEqual(sortRecentSongs(songs, "opened").map((song) => song.id), ["new-opened", "old-opened", "new-created"]);
  assert.deepEqual(sortRecentSongs(songs, "created").map((song) => song.id), ["new-created", "old-opened", "new-opened"]);
  assert.deepEqual(sortRecentSongs(songs, "updated").map((song) => song.id), ["old-opened", "new-opened", "new-created"]);
  assert.deepEqual(sortRecentSongs(songs, "title").map((song) => song.id), ["new-opened", "old-opened", "new-created"]);
});

test("groupSongsByArtist folds spacing and casing while sorting songs by title", () => {
  const groups = groupSongsByArtist([
    { id: "2", title: "Beta", artist: "Radiohead" },
    { id: "1", title: "Alpha", artist: " radiohead " },
    { id: "3", title: "Song", artist: "Joanna Newsom" }
  ]);

  assert.deepEqual(groups.map((group) => group.name), ["Joanna Newsom", "Radiohead"]);
  assert.deepEqual(groups.find((group) => group.name === "Radiohead").songs.map((song) => song.title), ["Alpha", "Beta"]);
});

test("playlist helpers keep ordered unique song ids", () => {
  const playlist = normalizePlaylist({ id: "playlist-1", name: "Set", songIds: ["a", "a", "b"] });

  assert.deepEqual(playlist.songIds, ["a", "b"]);
  assert.deepEqual(addSongToPlaylist(playlist, "c").songIds, ["a", "b", "c"]);
  assert.deepEqual(addSongToPlaylist(playlist, "a").songIds, ["a", "b"]);
  assert.deepEqual(removeSongFromPlaylist(playlist, "a").songIds, ["b"]);
  assert.deepEqual(movePlaylistSong({ ...playlist, songIds: ["a", "b", "c"] }, "c", -1).songIds, ["a", "c", "b"]);
});
