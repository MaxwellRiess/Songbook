import assert from "node:assert/strict";
import test from "node:test";
import { createLibraryBackup, mergeBackupSongs, parseLibraryBackup } from "../public/backup.js";

test("createLibraryBackup and parseLibraryBackup round-trip songs and deletes", () => {
  const backup = createLibraryBackup([{
    id: "song-1",
    title: "Song",
    artist: "Artist",
    rawContent: "[ch]G[/ch]Line",
    createdAt: "2026-05-19T09:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z"
  }], [{
    id: "song-2",
    deletedAt: "2026-05-19T11:00:00.000Z"
  }]);

  const parsed = parseLibraryBackup(JSON.stringify(backup));

  assert.equal(parsed.songs.length, 1);
  assert.equal(parsed.songs[0].title, "Song");
  assert.equal(parsed.deletedSongs[0].id, "song-2");
});

test("mergeBackupSongs keeps newer local songs and imports newer backup songs", () => {
  const existing = [
    { id: "same-local", title: "Local", updatedAt: "2026-05-19T12:00:00.000Z" },
    { id: "same-import", title: "Old", updatedAt: "2026-05-19T08:00:00.000Z" }
  ];
  const imported = [
    { id: "same-local", title: "Imported old", updatedAt: "2026-05-19T09:00:00.000Z" },
    { id: "same-import", title: "Imported new", updatedAt: "2026-05-19T13:00:00.000Z" },
    { id: "new", title: "New", updatedAt: "2026-05-19T10:00:00.000Z" }
  ];

  const result = mergeBackupSongs(existing, imported);

  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.songs.find((song) => song.id === "same-local").title, "Local");
  assert.equal(result.songs.find((song) => song.id === "same-import").title, "Imported new");
});
