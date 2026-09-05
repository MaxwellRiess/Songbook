import assert from "node:assert/strict";
import test from "node:test";
import {
  matchPosition,
  matchWord,
  resampleTo16k,
  tokenize
} from "../public/follow-mode.js";

function anchors(lines) {
  return lines.map((text, index) => ({ index, text, tokens: tokenize(text) }));
}

test("tokenize preserves accented and non-Latin lyric words", () => {
  assert.deepEqual(tokenize("Déjà vu, corazón — 東京!"), ["déjà", "vu", "corazón", "東京"]);
});

test("a distinctive one-word lyric can establish position", () => {
  const result = matchPosition(anchors(["Yesterday", "All my troubles seemed so far away"]), -1, tokenize("Yesterday"));
  assert.equal(result.committedIndex, 0);
});

test("word order distinguishes lines containing the same words", () => {
  const result = matchPosition(anchors(["love is all", "all is love"]), -1, tokenize("love is all"));
  assert.equal(result.committedIndex, 0);
});

test("preceding lyric context distinguishes repeated choruses", () => {
  const song = anchors([
    "the first verse fades into night",
    "sing it loud",
    "the second verse turns us around",
    "sing it loud"
  ]);
  const result = matchPosition(song, 1, tokenize("second verse turns us around sing it loud"));
  assert.equal(result.committedIndex, 3);
});

test("global context can distinguish a repeated chorus beyond the local window", () => {
  const song = anchors([
    "the first verse fades into night",
    "sing it loud",
    ...Array.from({ length: 8 }, (_, index) => `instrumental passage number ${index}`),
    "the second verse turns us around",
    "sing it loud"
  ]);
  const heard = tokenize("second verse turns us around sing it loud");

  assert.equal(matchPosition(song, 1, heard).committedIndex, 1);
  assert.equal(matchPosition(song, 1, heard, { global: true }).committedIndex, 11);
});

test("short words do not fuzzy-match unrelated short words", () => {
  assert.deepEqual(matchWord("me", new Set(["be"]), ["be"]), { matched: false, weight: 0 });
  assert.deepEqual(matchWord("love", new Set(["move"]), ["move"]), { matched: true, weight: 0.6 });
});

test("global recovery can find a line outside the normal lookahead", () => {
  const song = anchors(Array.from({ length: 12 }, (_, index) => `unique lyric number ${index}`));
  song[11] = { index: 11, text: "the distant recovery phrase", tokens: tokenize("the distant recovery phrase") };

  assert.equal(matchPosition(song, 0, tokenize("distant recovery phrase")).committedIndex, -1);
  assert.equal(matchPosition(song, 0, tokenize("distant recovery phrase"), { global: true }).committedIndex, 11);
});

test("resampling preserves duration and endpoints", () => {
  const input = Float32Array.from({ length: 48000 }, (_, index) => index / 48000);
  const output = resampleTo16k(input, 48000);
  assert.equal(output.length, 16000);
  assert.ok(Math.abs(output[0] - input[0]) < 1e-6);
  assert.ok(Math.abs(output.at(-1) - input.at(-3)) < 1e-4);
});
