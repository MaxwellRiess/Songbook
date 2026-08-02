import assert from "node:assert/strict";
import test from "node:test";
import { STANDARD_TUNING, getVoicings, parseChordSymbol } from "../public/chord-voicings.js";

const asString = (voicing) => voicing.frets.map((fret) => (fret === null ? "x" : fret)).join("-");

test("parses roots, qualities and slash bass notes", () => {
  assert.equal(parseChordSymbol("C").qualityName, "major");
  assert.equal(parseChordSymbol("Am7").qualityName, "minor 7th");
  assert.equal(parseChordSymbol("CM7").qualityName, "major 7th");
  assert.equal(parseChordSymbol("Cm7").qualityName, "minor 7th");
  assert.equal(parseChordSymbol("Bbmaj9").root, "Bb");
  assert.equal(parseChordSymbol("D/F#").bass, "F#");
  assert.deepEqual(parseChordSymbol("C").notes, ["C", "E", "G"]);
  assert.deepEqual(parseChordSymbol("Am7").notes, ["A", "C", "E", "G"]);
});

test("handles alterations that are not spelled out in the quality table", () => {
  const parsed = parseChordSymbol("G7b9");
  assert.ok(parsed);
  assert.deepEqual(parsed.notes, ["G", "B", "D", "F", "Ab"]);
});

test("rejects things that are not chords", () => {
  assert.equal(parseChordSymbol("Hmm"), null);
  assert.equal(parseChordSymbol("|"), null);
  assert.equal(parseChordSymbol("Cwobble"), null);
});

test("leads with the shape a guitarist already knows", () => {
  assert.equal(asString(getVoicings("C")[0]), "x-3-2-0-1-0");
  assert.equal(asString(getVoicings("Am")[0]), "x-0-2-2-1-0");
  assert.equal(asString(getVoicings("G")[0]), "3-2-0-0-0-3");
  assert.equal(asString(getVoicings("D")[0]), "x-x-0-2-3-2");
  assert.equal(asString(getVoicings("F")[0]), "1-3-3-2-1-1");
  assert.equal(asString(getVoicings("D/F#")[0]), "2-0-0-2-3-2");
});

test("works up the neck without repeating a position", () => {
  const voicings = getVoicings("Am7");
  assert.ok(voicings.length >= 4);

  const positions = voicings.map((voicing) => voicing.position);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal(new Set(positions).size, positions.length);
});

test("every shape is playable and spells the chord", () => {
  for (const symbol of ["C", "Am7", "F#m", "Bb13", "Esus4", "Dm9", "G/B", "Cdim7"]) {
    const parsed = parseChordSymbol(symbol);
    const voicings = getVoicings(symbol);
    assert.ok(voicings.length, `${symbol} produced no shapes`);

    const allowed = new Set(parsed.intervals.map((interval) => (parsed.rootPc + interval) % 12));
    if (parsed.bassPc !== null) allowed.add(parsed.bassPc);

    for (const voicing of voicings) {
      const sounded = voicing.frets
        .map((fret, string) => (fret === null ? null : { fret, string }))
        .filter(Boolean);

      assert.ok(voicing.fingerCount <= 4, `${symbol} ${asString(voicing)} needs too many fingers`);
      assert.ok(voicing.span <= 3, `${symbol} ${asString(voicing)} stretches too far`);

      for (const { fret, string } of sounded) {
        const pitchClass = (STANDARD_TUNING[string] + fret) % 12;
        assert.ok(allowed.has(pitchClass), `${symbol} ${asString(voicing)} plays a foreign note`);
      }

      // No muted string sandwiched between two sounded ones.
      const gap = voicing.frets
        .slice(sounded[0].string, sounded[sounded.length - 1].string + 1)
        .some((fret) => fret === null);
      assert.equal(gap, false, `${symbol} ${asString(voicing)} mutes an inner string`);

      /* The lowest sounding note is the root, or the bass note of a slash
         chord. This compares pitches rather than string numbers, because a low
         string fretted high can sit above an open string next to it. */
      const lowest = Math.min(
        ...sounded.map(({ fret, string }) => STANDARD_TUNING[string] + fret)
      );
      assert.equal(lowest % 12, parsed.bassPc === null ? parsed.rootPc : parsed.bassPc);
    }
  }
});

test("leaves inversions out unless they are asked for", () => {
  assert.equal(getVoicings("C").some((voicing) => voicing.inversion), false);
  assert.ok(getVoicings("C", { inversions: true }).some((voicing) => voicing.inversion));
});

test("labels inversions with the full chord symbol over the bass note", () => {
  const inversions = getVoicings("Am7", { inversions: true }).filter((voicing) => voicing.inversion);
  const names = [...new Set(inversions.map((voicing) => voicing.slashName))];
  assert.deepEqual(names, ["Am7/C", "Am7/E", "Am7/G"]);
});

test("puts root position first and each inversion on its own bass note", () => {
  const voicings = getVoicings("C", { inversions: true });
  const rootShapes = voicings.filter((voicing) => !voicing.inversion);
  assert.ok(rootShapes.length);
  assert.deepEqual(voicings.slice(0, rootShapes.length), rootShapes);

  for (const voicing of voicings.filter((voicing) => voicing.inversion)) {
    const sounded = voicing.frets
      .map((fret, string) => (fret === null ? null : STANDARD_TUNING[string] + fret))
      .filter((pitch) => pitch !== null);
    const expected = { E: 4, G: 7 }[voicing.bass];
    assert.equal(Math.min(...sounded) % 12, expected, `${voicing.slashName} bass is wrong`);
  }
});

test("does not invert a chord that already names its bass note", () => {
  assert.equal(getVoicings("C/G", { inversions: true }).some((voicing) => voicing.inversion), false);
});

const innerMuteCount = (voicing) => {
  const sounded = voicing.frets
    .map((fret, string) => (fret === null ? null : string))
    .filter((string) => string !== null);
  return voicing.frets
    .slice(sounded[0], sounded[sounded.length - 1] + 1)
    .filter((fret) => fret === null).length;
};

test("leaves muted inner strings out unless they are asked for", () => {
  for (const voicing of getVoicings("C")) {
    assert.equal(innerMuteCount(voicing), 0);
  }
  assert.ok(getVoicings("C", { innerMutes: true }).some((voicing) => voicing.innerMute));
});

test("every shape flagged as an inner mute actually has one, and the rest do not", () => {
  for (const symbol of ["C", "G13", "Am7", "Cm7"]) {
    for (const voicing of getVoicings(symbol, { innerMutes: true })) {
      const gaps = innerMuteCount(voicing);
      assert.equal(gaps > 0, Boolean(voicing.innerMute), `${symbol} ${voicing.frets.join("-")}`);
    }
  }
});

test("muted inner string shapes come after the shapes that strum whole", () => {
  const voicings = getVoicings("Am7", { innerMutes: true });
  const firstMuted = voicings.findIndex((voicing) => voicing.innerMute);
  assert.ok(firstMuted > 0);
  assert.equal(voicings.slice(0, firstMuted).some((voicing) => voicing.innerMute), false);
});

test("the two options combine without producing duplicate shapes", () => {
  const voicings = getVoicings("Am7", { inversions: true, innerMutes: true });
  const keys = voicings.map((voicing) => voicing.frets.join("-"));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(voicings.some((voicing) => voicing.inversion && voicing.innerMute));
});

test("names the notes under each string", () => {
  const [open] = getVoicings("Em");
  assert.deepEqual(open.noteNames, ["E", "B", "E", "G", "B", "E"]);
});

test("returns nothing for an unparseable symbol", () => {
  assert.deepEqual(getVoicings("Nope"), []);
});
