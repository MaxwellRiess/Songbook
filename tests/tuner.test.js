import assert from "node:assert/strict";
import test from "node:test";
import { STANDARD_TUNING, formatFrequency, noteFrequency, tuningPitches } from "../public/tuner.js";

test("A4 is the reference pitch", () => {
  assert.equal(noteFrequency(69), 440);
  assert.equal(noteFrequency(69, 432), 432);
});

test("octaves double and semitones follow equal temperament", () => {
  assert.equal(noteFrequency(81), 880);
  assert.equal(noteFrequency(57), 220);
  assert.ok(Math.abs(noteFrequency(70) - 466.16) < 0.01);
});

test("standard tuning matches the published concert pitches", () => {
  const byString = new Map(tuningPitches().map((pitch) => [pitch.string, pitch]));
  const expected = [
    [6, "E2", 82.41],
    [5, "A2", 110.0],
    [4, "D3", 146.83],
    [3, "G3", 196.0],
    [2, "B3", 246.94],
    [1, "E4", 329.63]
  ];

  for (const [string, label, frequency] of expected) {
    const pitch = byString.get(string);
    assert.equal(pitch.label, label);
    assert.ok(
      Math.abs(pitch.frequency - frequency) < 0.01,
      `string ${string} was ${pitch.frequency}, expected about ${frequency}`
    );
  }
});

test("strings run low to high", () => {
  const frequencies = tuningPitches().map((pitch) => pitch.frequency);
  const sorted = [...frequencies].sort((a, b) => a - b);
  assert.deepEqual(frequencies, sorted);
  assert.deepEqual(
    STANDARD_TUNING.map((entry) => entry.string),
    [6, 5, 4, 3, 2, 1]
  );
});

test("a different reference pitch moves every string by the same ratio", () => {
  const standard = tuningPitches();
  const shifted = tuningPitches(432);
  for (let index = 0; index < standard.length; index += 1) {
    const ratio = shifted[index].frequency / standard[index].frequency;
    assert.ok(Math.abs(ratio - 432 / 440) < 1e-12);
  }
});

test("frequencies are shown to two decimal places", () => {
  assert.equal(formatFrequency(110), "110.00 Hz");
  assert.equal(formatFrequency(82.4069), "82.41 Hz");
});
