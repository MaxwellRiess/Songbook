/* Works out what key a song is in from its chords, and names a chord's function
   within that key.

   This is chord-vocabulary analysis, not melody analysis: it reads the set of
   chords a song uses and how often, and nothing about the tune. Relative major
   and minor share a diatonic set, so the tonic and dominant emphasis is what
   separates them; where a song does not lean either way the margin stays small
   and the caller is expected to hold back rather than guess.

   Kept free of the DOM so it can be tested on its own. */

import { parseChordSymbol, spellNote } from "./chord-voicings.js";

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/* The diatonic triad quality on each degree, as interval sets from the chord's
   own root. A song in a minor key usually borrows the major dominant, so both
   the natural v and the harmonic V count as diatonic on the fifth degree. */
const MAJOR_DEGREES = [
  { at: 0, thirds: ["major"] },
  { at: 2, thirds: ["minor"] },
  { at: 4, thirds: ["minor"] },
  { at: 5, thirds: ["major"] },
  { at: 7, thirds: ["major", "dominant"] },
  { at: 9, thirds: ["minor"] },
  { at: 11, thirds: ["diminished"] }
];

const MINOR_DEGREES = [
  { at: 0, thirds: ["minor"] },
  { at: 2, thirds: ["diminished"] },
  { at: 3, thirds: ["major"] },
  { at: 5, thirds: ["minor"] },
  { at: 7, thirds: ["minor", "major", "dominant"] },
  { at: 8, thirds: ["major"] },
  { at: 10, thirds: ["major"] }
];

const DIATONIC_FIT = 3;
const IN_SCALE_FIT = 1;
const TONIC_BONUS = 2;
const DOMINANT_BONUS = 1.5;
const FIRST_CHORD_BONUS = 1.5;
const LAST_CHORD_BONUS = 3;

/* Below this margin over the runner-up the answer is not worth showing. Songs
   that sit evenly between relative keys land here, which is the point. */
export const CONFIDENCE_FLOOR = 0.06;

/* Reduces a chord to the third it presents, which is what decides whether it
   sits on a degree. Suspended and power chords state no third and are treated
   as neutral: they fit any degree whose root they match. */
function thirdOf(chord) {
  const intervals = new Set(chord.intervals.map((step) => step % 12));
  // A sharp ninth folds onto the minor third, so a dominant has to be read
  // before one: G7#9 states a major third and an A sharp, not a minor third.
  if (intervals.has(4) && intervals.has(10)) return "dominant";
  if (intervals.has(3) && intervals.has(6)) return "diminished";
  if (intervals.has(3)) return "minor";
  if (intervals.has(4)) return "major";
  return "neutral";
}

const pitchClasses = (chord) => new Set(chord.intervals.map((step) => (chord.rootPc + step) % 12));

function degreeFit(chord, tonicPc, degrees, scale) {
  const from = (chord.rootPc - tonicPc + 12) % 12;
  const degree = degrees.find((entry) => entry.at === from);
  const third = thirdOf(chord);
  if (degree && (third === "neutral" || degree.thirds.includes(third))) return DIATONIC_FIT;
  if (scale.includes(from)) return IN_SCALE_FIT;
  return 0;
}

function scoreKey(parsed, tonicPc, mode) {
  const degrees = mode === "major" ? MAJOR_DEGREES : MINOR_DEGREES;
  const scale = mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  const dominantAt = 7;
  let score = 0;

  for (const chord of parsed) {
    score += degreeFit(chord, tonicPc, degrees, scale);
    const from = (chord.rootPc - tonicPc + 12) % 12;
    const third = thirdOf(chord);
    // Landing on the tonic and using its dominant are what tell a key apart
    // from its relative, which shares every diatonic chord with it.
    if (from === 0 && (third === "neutral" || degrees[0].thirds.includes(third))) score += TONIC_BONUS;
    if (from === dominantAt && (third === "dominant" || third === "major")) score += DOMINANT_BONUS;
  }

  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  if (first && (first.rootPc - tonicPc + 12) % 12 === 0) score += FIRST_CHORD_BONUS;
  if (last && (last.rootPc - tonicPc + 12) % 12 === 0) score += LAST_CHORD_BONUS;

  return score;
}

/* Takes chord symbols in the order they are played, repeats included, and
   returns the best key with a confidence, or null when nothing parses. The
   caller decides whether the confidence is worth acting on. */
export function inferKey(symbols) {
  const parsed = (symbols || []).map(parseChordSymbol).filter(Boolean);
  if (parsed.length < 2) return null;

  const scored = [];
  for (let tonicPc = 0; tonicPc < 12; tonicPc += 1) {
    for (const mode of ["major", "minor"]) {
      scored.push({ tonicPc, mode, score: scoreKey(parsed, tonicPc, mode) });
    }
  }
  scored.sort((one, other) => other.score - one.score);

  const [best, runnerUp] = scored;
  if (best.score <= 0) return null;

  const useFlats = parsed.some((chord) => chord.useFlats);
  const tonic = spellNote(best.tonicPc, useFlats);
  return {
    tonicPc: best.tonicPc,
    mode: best.mode,
    tonic,
    name: `${tonic} ${best.mode}`,
    confidence: (best.score - runnerUp.score) / best.score,
    confident: (best.score - runnerUp.score) / best.score >= CONFIDENCE_FLOOR
  };
}

/* True when every note of the chord belongs to the key's scale. */
export function isDiatonic(symbol, key) {
  const chord = parseChordSymbol(symbol);
  if (!chord || !key) return false;
  const scale = key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  const allowed = new Set(scale.map((step) => (key.tonicPc + step) % 12));
  return [...pitchClasses(chord)].every((note) => allowed.has(note));
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

/* Names the chord's degree in the key: "IV", "ii7", "bVII". Case carries the
   third, so a minor chord's own "m" is dropped from the suffix and everything
   else the symbol says is kept. */
export function romanNumeral(symbol, key) {
  const chord = parseChordSymbol(symbol);
  if (!chord || !key) return "";
  const scale = key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  const from = (chord.rootPc - key.tonicPc + 12) % 12;

  let index = scale.indexOf(from);
  let accidental = "";
  if (index === -1) {
    // A note outside the scale is named as the flattened degree above it, which
    // is how the chromatic degrees are normally written: bII, bIII, bV, bVI,
    // bVII. Sharpening the degree below is the fallback.
    index = scale.indexOf((from + 1) % 12);
    if (index !== -1) accidental = "b";
    else {
      index = scale.indexOf((from + 11) % 12);
      if (index === -1) return "";
      accidental = "#";
    }
  }

  const third = thirdOf(chord);
  const lower = third === "minor" || third === "diminished";
  const numeral = lower ? NUMERALS[index].toLowerCase() : NUMERALS[index];
  const suffix = chord.symbol
    .slice(chord.root.length)
    .replace(/^(m|min)(?![a])/, "")
    .replace(/^dim/, "°");

  return `${accidental}${numeral}${suffix}`;
}

/* The degree a chord sits on, 1-7, or 0 when it is outside the scale. Used to
   decide which key-dependent suggestions apply. */
export function scaleDegree(symbol, key) {
  const chord = parseChordSymbol(symbol);
  if (!chord || !key) return 0;
  const scale = key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  const index = scale.indexOf((chord.rootPc - key.tonicPc + 12) % 12);
  return index === -1 ? 0 : index + 1;
}
