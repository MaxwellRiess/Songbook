import assert from "node:assert/strict";
import test from "node:test";
import { detectSongConflicts, mergeSongs } from "../public/song-sync.js";

test("mergeSongs keeps the newest copy for matching songs", () => {
  const local = [{ id: "song-1", title: "Local", updatedAt: "2026-05-19T10:00:00.000Z" }];
  const remote = [{ id: "song-1", title: "Remote", updatedAt: "2026-05-19T09:00:00.000Z" }];

  assert.deepEqual(mergeSongs(local, remote), local);
});

test("mergeSongs filters pending deletes from local and remote results", () => {
  const deleted = [{ id: "song-1", deletedAt: "2026-05-19T11:00:00.000Z" }];
  const local = [
    { id: "song-1", title: "Local deleted", updatedAt: "2026-05-19T10:00:00.000Z" },
    { id: "song-2", title: "Local kept", updatedAt: "2026-05-19T08:00:00.000Z" }
  ];
  const remote = [
    { id: "song-1", title: "Remote deleted", updatedAt: "2026-05-19T12:00:00.000Z" },
    { id: "song-3", title: "Remote kept", updatedAt: "2026-05-19T07:00:00.000Z" }
  ];

  assert.deepEqual(mergeSongs(local, remote, deleted).map((song) => song.id), ["song-2", "song-3"]);
});

test("detectSongConflicts reports local and remote edits to the same song", () => {
  const local = [{
    id: "song-1",
    title: "Local title",
    artist: "Artist",
    rawContent: "Local lyrics",
    updatedAt: "2026-05-19T10:00:00.000Z"
  }];
  const remote = [{
    id: "song-1",
    title: "Remote title",
    artist: "Artist",
    rawContent: "Remote lyrics",
    updatedAt: "2026-05-19T11:00:00.000Z"
  }];

  assert.deepEqual(detectSongConflicts(local, remote).map((conflict) => ({
    id: conflict.id,
    title: conflict.title,
    winningSource: conflict.winningSource
  })), [{
    id: "song-1",
    title: "Remote title",
    winningSource: "remote"
  }]);
});
