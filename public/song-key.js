/* Works out what key a song is in from its chords, and names a chord's function
   within that key.

   This is chord-progression analysis, not melody analysis: it reads which
   chords a song uses, how often, and how they resolve into each other, and
   nothing about the tune.

   Counting chord membership alone is not enough. Relative major and minor share
   every diatonic chord, so a song that visits both scores almost evenly however
   long you count for. What separates them is where the music actually lands, so
   cadences carry the most weight here, and the song's closing cadence carries
   the most of all. Where a song still leans neither way the margin stays small
   and the caller is expected to hold back rather than guess.

   `tests/fixtures/keys.js` holds the songs these weights are answerable to.

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
/* Starting or ending on a chord is weak evidence on its own: a sheet written
   out once ends where the writer stopped, and a vamp ends nowhere in
   particular. Landing on the tonic counts, but arriving there by a cadence is
   what carries the weight, so these two stay level and small. */
const LAST_CHORD_BONUS = 1.5;

/* Where the music lands. An authentic cadence is the strongest ordinary
   evidence of a key, and the one a song closes with is stronger still. */
const AUTHENTIC_CADENCE = 4;
const PLAGAL_CADENCE = 2;
/* A dominant that sidesteps to the sixth degree instead of resolving is
   evidence for the key it declined to land in, not against it. Without this a
   song that keeps deferring its tonic reads as being in its relative minor. */
const DECEPTIVE_CADENCE = 2;
const TWO_FIVE_ONE = 3;
const FINAL_CADENCE = 6;
/* Blues and its relatives put a dominant seventh on the tonic and on the
   fourth. Both then fall outside the major scale, so counting scale membership
   alone reads such a song as being in the key a fourth above, and a tonic the
   scale rejects also loses its tonic bonus and every cadence into it. Where a
   song shows the pair, those two degrees accept a dominant seventh as their own
   chord for that key, which is what a blues player hears them as. */
const BLUES_DEGREES = [0, 5];

/* Confidence is the winning margin per chord, not a share of the total score.
   Both separate the corpus, but a share of the total leaves only 0.08 between
   the songs that must stay unnamed and the closest one that must be named,
   because most of that total is baseline diatonic fit every plausible key
   earns. Per chord the same boundary has 0.44 of room, so a new song has to be
   badly misjudged rather than marginally so before it crosses.

   Per chord is not scale-free: the one-off bonuses for the first chord, the
   last chord and the closing cadence do not grow when a song repeats, so the
   same progression played four times reads a little lower than once through.
   That costs less than the narrow boundary does.

   Below this floor the answer is not worth showing. On the corpus the songs
   that must stay unnamed sit at zero and the closest nameable one at 0.44. */
export const CONFIDENCE_FLOOR = 0.25;

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

/* Where a chord sits relative to a tonic, with the third it presents. */
const place = (chord, tonicPc) => ({
  at: (chord.rootPc - tonicPc + 12) % 12,
  third: thirdOf(chord)
});

const isTonic = (spot, degrees) =>
  spot.at === 0 && (spot.third === "neutral" || degrees[0].thirds.includes(spot.third));

const isDominant = (spot) => spot.at === 7 && (spot.third === "dominant" || spot.third === "major");

/* Names the cadence one pair of chords makes toward a tonic, or nothing. The
   kind matters as well as the size: only an authentic close earns the weight
   for ending a song, because a sheet written out once ends wherever the writer
   stopped, and a loop that happens to break on its fourth degree is not
   cadencing there. */
function cadenceBetween(before, after, degrees) {
  if (isTonic(after, degrees)) {
    if (isDominant(before)) return { weight: AUTHENTIC_CADENCE, authentic: true };
    if (before.at === 5) return { weight: PLAGAL_CADENCE, authentic: false };
    return null;
  }
  /* A dominant seventh stepping to the sixth degree is a resolution withheld.
     A plain major triad doing the same thing is asking for nothing, and reading
     it as a withheld cadence turns modal tunes into the wrong major key. */
  if (before.at === 7 && before.third === "dominant" && after.at === 9 && after.third === "minor") {
    return { weight: DECEPTIVE_CADENCE, authentic: false };
  }
  return null;
}

function scoreKey(parsed, tonicPc, mode) {
  const scale = mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  const spots = parsed.map((chord) => place(chord, tonicPc));

  let degrees = mode === "major" ? MAJOR_DEGREES : MINOR_DEGREES;
  const carriesDominant = (at) => spots.some((spot) => spot.at === at && spot.third === "dominant");
  if (mode === "major" && BLUES_DEGREES.every(carriesDominant)) {
    degrees = degrees.map((degree) =>
      BLUES_DEGREES.includes(degree.at) ? { ...degree, thirds: [...degree.thirds, "dominant"] } : degree);
  }

  let score = 0;

  parsed.forEach((chord, at) => {
    score += degreeFit(chord, tonicPc, degrees, scale);
    if (isTonic(spots[at], degrees)) score += TONIC_BONUS;
    if (isDominant(spots[at])) score += DOMINANT_BONUS;
  });

  for (let at = 1; at < spots.length; at += 1) {
    const cadence = cadenceBetween(spots[at - 1], spots[at], degrees);
    score += cadence?.weight || 0;
    // The cadence a song closes on says more than any of the ones before it.
    if (cadence?.authentic && at === spots.length - 1) score += FINAL_CADENCE;
    // A second degree stepping through the dominant into the tonic.
    if (at >= 2 && spots[at - 2].at === 2 && isDominant(spots[at - 1]) && isTonic(spots[at], degrees)) {
      score += TWO_FIVE_ONE;
    }
  }

  if (spots.length && spots[0].at === 0) score += FIRST_CHORD_BONUS;
  if (spots.length && spots[spots.length - 1].at === 0) score += LAST_CHORD_BONUS;

  return score;
}

/* Every candidate key scored and ranked, best first. Exported so the corpus
   tests and any diagnosis can see what came second and by how much. */
export function rankKeys(symbols) {
  const parsed = (symbols || []).map(parseChordSymbol).filter(Boolean);
  if (parsed.length < 2) return [];
  const useFlats = parsed.some((chord) => chord.useFlats);

  const scored = [];
  for (let tonicPc = 0; tonicPc < 12; tonicPc += 1) {
    for (const mode of ["major", "minor"]) {
      scored.push({
        tonicPc,
        mode,
        name: `${spellNote(tonicPc, useFlats)} ${mode}`,
        score: scoreKey(parsed, tonicPc, mode)
      });
    }
  }
  return scored.sort((one, other) => other.score - one.score);
}

/* Takes chord symbols in the order they are played, repeats included, and
   returns the best key with a confidence, or null when nothing parses. The
   caller decides whether the confidence is worth acting on. */
export function inferKey(symbols) {
  const parsed = (symbols || []).map(parseChordSymbol).filter(Boolean);
  if (parsed.length < 2) return null;

  const scored = rankKeys(symbols);
  const [best, runnerUp] = scored;
  if (best.score <= 0) return null;

  const useFlats = parsed.some((chord) => chord.useFlats);
  const tonic = spellNote(best.tonicPc, useFlats);
  const confidence = (best.score - runnerUp.score) / parsed.length;
  return {
    tonicPc: best.tonicPc,
    mode: best.mode,
    tonic,
    name: `${tonic} ${best.mode}`,
    confidence,
    confident: confidence >= CONFIDENCE_FLOOR
  };
}

/* The pitch classes the key's scale contains. Exported because asking whether
   one note belongs to a key is a different question from asking whether a whole
   chord does, and a caller comparing two chords against each other needs the
   first one. */
export function keyPitchClasses(key) {
  if (!key) return null;
  const scale = key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  return new Set(scale.map((step) => (key.tonicPc + step) % 12));
}

/* True when every note of the chord belongs to the key's scale. */
export function isDiatonic(symbol, key) {
  const chord = parseChordSymbol(symbol);
  if (!chord || !key) return false;
  const allowed = keyPitchClasses(key);
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
