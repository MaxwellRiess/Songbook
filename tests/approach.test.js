import assert from "node:assert/strict";
import test from "node:test";
import { suggestApproaches } from "../public/approach.js";
import { parseChordSymbol } from "../public/chord-voicings.js";

const into = (symbol, context) => suggestApproaches(symbol, context).map((option) => option.chords.join(" "));

test("offers the four ways into a major chord", () => {
  assert.deepEqual(into("D"), ["A7", "Em7 A7", "Eb7", "C#dim7"]);
});

test("a minor target takes the minor two-five", () => {
  // The second degree of a minor key is half diminished, not a plain minor
  // seventh, so the two-five into a minor chord has to follow.
  assert.deepEqual(into("Bm"), ["F#7", "C#m7b5 F#7", "C7", "A#dim7"]);
  assert.deepEqual(into("Am7"), ["E7", "Bm7b5 E7", "Bb7", "G#dim7"]);
});

test("function decides the spelling, not the target chord", () => {
  // A chord a semitone above is a flattened second and is written flat, even
  // above a chord that spells itself with sharps. A diminished a semitone below
  // is the raised seventh leading up, and is written sharp.
  const aboveD = suggestApproaches("D")[2].chords[0];
  const belowD = suggestApproaches("D")[3].chords[0];
  assert.equal(aboveD, "Eb7", "a semitone above D should be flat");
  assert.equal(belowD, "C#dim7", "a semitone below D should be sharp");
  assert.equal(suggestApproaches("Am7")[2].chords[0], "Bb7");
  assert.equal(suggestApproaches("Bb")[2].chords[0], "B7");
});

test("every approach it offers is a chord the app can read and draw", () => {
  for (const target of ["C", "Dm", "F#m7", "Bbmaj7", "G7", "Ebm", "A", "Bdim7", "Csus4", "C/E"]) {
    const options = suggestApproaches(target);
    assert.ok(options.length >= 3, target);
    for (const option of options) {
      for (const chord of option.chords) {
        assert.ok(parseChordSymbol(chord), `${chord} approaching ${target}`);
      }
      assert.ok(option.label);
      assert.ok(option.explanation);
    }
  }
});

test("the dominant is a fifth above the target, whatever the target is", () => {
  for (const target of ["C", "F#m", "Bbmaj7", "Ebm7"]) {
    const chord = parseChordSymbol(target);
    const dominant = parseChordSymbol(suggestApproaches(target)[0].chords[0]);
    assert.equal((dominant.rootPc - chord.rootPc + 12) % 12, 7, target);
    // And it is a dominant seventh, not a plain triad.
    assert.ok(dominant.intervals.includes(4) && dominant.intervals.includes(10), target);
  }
});

test("says when the song already plays the approach", () => {
  const withDominant = suggestApproaches("C", { prevChord: "G7" });
  assert.equal(withDominant[0].alreadyThere, true);
  // A two-chord approach is never claimed to be already there off one chord.
  assert.equal(withDominant[1].alreadyThere, false);
  assert.equal(suggestApproaches("C", { prevChord: "F" })[0].alreadyThere, false);
  assert.equal(suggestApproaches("C")[0].alreadyThere, false);
  // The plain triad counts as the same approach as its seventh only when the
  // third matches, so G major before C is not G7.
  assert.equal(suggestApproaches("C", { prevChord: "G" })[0].alreadyThere, false);
});

test("gives nothing for a symbol it cannot read", () => {
  assert.deepEqual(suggestApproaches("N.C."), []);
  assert.deepEqual(suggestApproaches(""), []);
  assert.deepEqual(suggestApproaches(null), []);
});
