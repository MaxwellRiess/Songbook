/* Chord voicing engine.

   Turns a chord symbol ("Am7", "C/G", "Bb13") into a ranked list of playable
   guitar shapes spread up the neck, in the spirit of a chord calculator.
   Shapes are generated from the fretboard rather than looked up in a table,
   so unusual symbols still return something useful. */

export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64]; // low E to high E, MIDI

const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const LETTER_PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/* Interval formulas in semitones from the root. Values above 11 are extensions
   and are folded into pitch classes when shapes are searched. `optional` lists
   the tones a shape may leave out (the fifth first, then lower extensions). */
const QUALITIES = {
  maj: { name: "major", intervals: [0, 4, 7], optional: [] },
  m: { name: "minor", intervals: [0, 3, 7], optional: [] },
  5: { name: "power chord", intervals: [0, 7], optional: [] },
  dim: { name: "diminished", intervals: [0, 3, 6], optional: [] },
  dim7: { name: "diminished 7th", intervals: [0, 3, 6, 9], optional: [] },
  m7b5: { name: "half diminished", intervals: [0, 3, 6, 10], optional: [] },
  aug: { name: "augmented", intervals: [0, 4, 8], optional: [] },
  6: { name: "6th", intervals: [0, 4, 7, 9], optional: [7] },
  m6: { name: "minor 6th", intervals: [0, 3, 7, 9], optional: [7] },
  "69": { name: "6/9", intervals: [0, 4, 7, 9, 14], optional: [7] },
  7: { name: "dominant 7th", intervals: [0, 4, 7, 10], optional: [7] },
  maj7: { name: "major 7th", intervals: [0, 4, 7, 11], optional: [7] },
  m7: { name: "minor 7th", intervals: [0, 3, 7, 10], optional: [7] },
  mmaj7: { name: "minor major 7th", intervals: [0, 3, 7, 11], optional: [7] },
  "7sus4": { name: "7sus4", intervals: [0, 5, 7, 10], optional: [7] },
  sus2: { name: "sus2", intervals: [0, 2, 7], optional: [] },
  sus4: { name: "sus4", intervals: [0, 5, 7], optional: [] },
  9: { name: "9th", intervals: [0, 4, 7, 10, 14], optional: [7] },
  maj9: { name: "major 9th", intervals: [0, 4, 7, 11, 14], optional: [7] },
  m9: { name: "minor 9th", intervals: [0, 3, 7, 10, 14], optional: [7] },
  add9: { name: "add9", intervals: [0, 4, 7, 14], optional: [] },
  madd9: { name: "minor add9", intervals: [0, 3, 7, 14], optional: [] },
  11: { name: "11th", intervals: [0, 7, 10, 14, 17], optional: [7, 14] },
  m11: { name: "minor 11th", intervals: [0, 3, 7, 10, 14, 17], optional: [7, 14] },
  maj11: { name: "major 11th", intervals: [0, 4, 7, 11, 14, 17], optional: [7, 14] },
  13: { name: "13th", intervals: [0, 4, 7, 10, 14, 21], optional: [7, 14] },
  m13: { name: "minor 13th", intervals: [0, 3, 7, 10, 14, 21], optional: [7, 14] },
  maj13: { name: "major 13th", intervals: [0, 4, 7, 11, 14, 21], optional: [7, 14] }
};

const ALIASES = {
  "": "maj",
  maj: "maj",
  major: "maj",
  m: "m",
  minor: "m",
  min: "m",
  5: "5",
  no3: "5",
  dim: "dim",
  o: "dim",
  "°": "dim",
  dim7: "dim7",
  o7: "dim7",
  "°7": "dim7",
  m7b5: "m7b5",
  "m7-5": "m7b5",
  "ø": "m7b5",
  "ø7": "m7b5",
  halfdim: "m7b5",
  aug: "aug",
  "+": "aug",
  "maj#5": "aug",
  "+5": "aug",
  6: "6",
  m6: "m6",
  min6: "m6",
  69: "69",
  "6add9": "69",
  "maj69": "69",
  7: "7",
  dom7: "7",
  maj7: "maj7",
  "maj7th": "maj7",
  m7: "m7",
  min7: "m7",
  mmaj7: "mmaj7",
  minmaj7: "mmaj7",
  "m#7": "mmaj7",
  "7sus4": "7sus4",
  "7sus": "7sus4",
  sus: "sus4",
  sus2: "sus2",
  sus4: "sus4",
  "9sus4": "11",
  9: "9",
  maj9: "maj9",
  m9: "m9",
  min9: "m9",
  add9: "add9",
  add2: "add9",
  madd9: "madd9",
  "m add9": "madd9",
  11: "11",
  m11: "m11",
  min11: "m11",
  maj11: "maj11",
  13: "13",
  m13: "m13",
  min13: "m13",
  maj13: "maj13"
};

/* Alterations that can hang off any base quality, e.g. 7b9, 13#11, m7b5. */
const ALTERATIONS = {
  b5: { remove: 7, add: 6 },
  "#5": { remove: 7, add: 8 },
  b9: { remove: null, add: 13 },
  "#9": { remove: null, add: 15 },
  "#11": { remove: null, add: 18 },
  b13: { remove: null, add: 20 }
};

export function parseChordSymbol(symbol) {
  if (typeof symbol !== "string") return null;

  const cleaned = symbol
    .trim()
    .replace(/^[([{]+/, "")
    .replace(/[)\]}]+$/, "")
    .replace(/[.,;:]+$/, "");

  const match = cleaned.match(/^([A-G])([#b♯♭]?)(.*)$/);
  if (!match) return null;

  const [, letter, accidental, remainder] = match;
  const rootPc = normalisePitchClass(letter, accidental);
  if (rootPc === null) return null;

  let suffix = remainder;
  let bassPc = null;
  let bassName = null;

  const slash = suffix.indexOf("/");
  if (slash !== -1) {
    const bassPart = suffix.slice(slash + 1).trim();
    suffix = suffix.slice(0, slash);
    const bassMatch = bassPart.match(/^([A-G])([#b♯♭]?)$/);
    if (!bassMatch) return null;
    bassPc = normalisePitchClass(bassMatch[1], bassMatch[2]);
    if (bassPc === null) return null;
    bassName = spellNote(bassPc, prefersFlats(accidental, bassMatch[2]));
  }

  const quality = resolveQuality(suffix);
  if (!quality) return null;

  const useFlats = prefersFlats(accidental, "");
  const rootName = spellNote(rootPc, useFlats);

  return {
    symbol: cleaned,
    root: rootName,
    rootPc,
    bass: bassName,
    bassPc,
    quality: quality.key,
    qualityName: quality.name,
    intervals: quality.intervals,
    optional: quality.optional,
    useFlats,
    notes: quality.intervals.map((interval) =>
      spellNote((rootPc + interval) % 12, spellsFlat(interval, useFlats))
    )
  };
}

/* A minor third, flat fifth, flat seventh, flat ninth or flat thirteenth is
   written flat whatever the root is; a sharp fifth, ninth or eleventh sharp. */
const FLAT_INTERVALS = new Set([3, 6, 10, 13, 20]);
const SHARP_INTERVALS = new Set([8, 15, 18]);

function spellsFlat(interval, useFlats) {
  if (FLAT_INTERVALS.has(interval)) return true;
  if (SHARP_INTERVALS.has(interval)) return false;
  return useFlats;
}

function normalisePitchClass(letter, accidental) {
  const base = LETTER_PITCH[letter.toUpperCase()];
  if (base === undefined) return null;
  const shift = accidental === "#" || accidental === "♯" ? 1 : accidental === "b" || accidental === "♭" ? -1 : 0;
  return (base + shift + 12) % 12;
}

function prefersFlats(...accidentals) {
  return accidentals.some((value) => value === "b" || value === "♭");
}

export function spellNote(pitchClass, useFlats) {
  return (useFlats ? NOTES_FLAT : NOTES_SHARP)[((pitchClass % 12) + 12) % 12];
}

function resolveQuality(rawSuffix) {
  const normalised = normaliseSuffix(rawSuffix);

  const direct = ALIASES[normalised];
  if (direct && QUALITIES[direct]) return { key: direct, ...QUALITIES[direct] };

  /* Peel off alterations and apply them to whatever base is left. */
  const found = [];
  let base = normalised;
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of ["#11", "b13", "#9", "b9", "#5", "b5"]) {
      const at = base.lastIndexOf(token);
      if (at === -1) continue;
      // "b5" inside "m7b5" is handled by the direct alias above.
      found.push(token);
      base = base.slice(0, at) + base.slice(at + token.length);
      changed = true;
    }
  }
  if (!found.length) return null;

  const baseKey = ALIASES[base] || ALIASES[base.replace(/alt$/, "")] || (base === "" ? "maj" : null);
  if (!baseKey || !QUALITIES[baseKey]) return null;

  const template = QUALITIES[baseKey];
  const intervals = [...template.intervals];
  for (const token of found) {
    const change = ALTERATIONS[token];
    if (!change) continue;
    if (change.remove !== null) {
      const at = intervals.indexOf(change.remove);
      if (at !== -1) intervals.splice(at, 1);
    }
    if (!intervals.includes(change.add)) intervals.push(change.add);
  }

  return {
    key: `${baseKey}${found.join("")}`,
    name: `${template.name} ${found.join(" ")}`.trim(),
    intervals,
    optional: template.optional.filter((interval) => intervals.includes(interval))
  };
}

function normaliseSuffix(raw) {
  let suffix = String(raw || "").replace(/[()\s]/g, "");
  suffix = suffix.replace(/^[-−]/, "m");
  suffix = suffix.replace(/^Δ/, "maj");
  suffix = suffix.replace(/^(maj|Maj|MAJ)/, "maj");
  suffix = suffix.replace(/^(min|Min|MIN)/, "m");
  suffix = suffix.replace(/^M(?=$|[0-9])/, "maj");
  suffix = suffix.replace(/♯/g, "#").replace(/♭/g, "b");
  return suffix.toLowerCase();
}

/* ---------- familiar open shapes ----------

   The generator alone will happily rank an unusual but efficient shape above
   the one everybody actually plays. These are the shapes a guitarist expects to
   see first; anything not listed here falls through to the search. */
const OPEN_SHAPES = {
  "C": "x32010",
  "C7": "x32310",
  "Cmaj7": "x32000",
  "Csus2": "x30010",
  "Csus4": "x33010",
  "Cadd9": "x32030",
  "C6": "x32210",
  "C/G": "332010",
  "C/E": "032010",
  "D": "xx0232",
  "Dm": "xx0231",
  "D7": "xx0212",
  "Dm7": "xx0211",
  "Dmaj7": "xx0222",
  "Dsus2": "xx0230",
  "Dsus4": "xx0233",
  "D6": "xx0202",
  "D/F#": "200232",
  "D/A": "x00232",
  "E": "022100",
  "Em": "022000",
  "E7": "020100",
  "Em7": "020000",
  "Emaj7": "021100",
  "Esus4": "022200",
  "Em6": "022020",
  "E7sus4": "020200",
  "F": "133211",
  "Fmaj7": "xx3210",
  "Fm": "133111",
  "F7": "131211",
  "F/C": "x33211",
  "G": "320003",
  "G7": "320001",
  "Gmaj7": "320002",
  "Gsus4": "320013",
  "G6": "320000",
  "Gadd9": "320203",
  "G/B": "x20003",
  "G/D": "xx0003",
  "A": "x02220",
  "Am": "x02210",
  "A7": "x02020",
  "Am7": "x02010",
  "Amaj7": "x02120",
  "Asus2": "x02200",
  "Asus4": "x02230",
  "A6": "x02222",
  "Am6": "x02212",
  "A7sus4": "x02030",
  "A/E": "002220",
  "Am/E": "002210",
  "B7": "x21202",
  "Bm7": "x20202",
  "Bm": "x24432",
  "B": "x24442",
  "Bb": "x13331",
  "Bbm": "x13321",
  "Bbmaj7": "x13231"
};

const OPEN_SHAPE_INDEX = buildOpenShapeIndex();

function buildOpenShapeIndex() {
  const index = new Map();
  for (const [symbol, frets] of Object.entries(OPEN_SHAPES)) {
    const parsed = parseChordSymbol(symbol);
    if (!parsed) continue;
    index.set(shapeKey(parsed), frets.split("").map((char) => (char === "x" ? null : Number(char))));
  }
  return index;
}

function shapeKey(parsed) {
  return `${parsed.rootPc}|${parsed.quality}|${parsed.bassPc === null ? "" : parsed.bassPc}`;
}

/* ---------- shape search ---------- */

const FRET_SPAN = 3; // a four-fret window
const MAX_FRET = 12;

/* Which chord tones are worth putting in the bass when inversions are asked
   for: the third, fifth and seventh. An extension in the bass is a different
   chord in practice, not an inversion of this one. */
const INVERTIBLE_INTERVALS = [3, 4, 6, 7, 8, 10, 11];

export function getVoicings(symbol, options = {}) {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return [];

  const tuning = options.tuning || STANDARD_TUNING;
  const limit = options.limit || 14;
  const inversionLimit = options.inversionLimit || 5;

  const chordPcs = new Set(parsed.intervals.map((interval) => (parsed.rootPc + interval) % 12));
  const requiredPcs = parsed.intervals
    .filter((interval) => !parsed.optional.includes(interval))
    .map((interval) => (parsed.rootPc + interval) % 12);
  if (parsed.bassPc !== null) chordPcs.add(parsed.bassPc);

  const context = { parsed, tuning, chordPcs, requiredPcs, perPosition: options.perPosition || 1 };
  const seen = new Set();

  const rootBass = parsed.bassPc === null ? parsed.rootPc : parsed.bassPc;
  const results = search(context, rootBass, seen).slice(0, limit);

  /* Inversions are a separate, labelled group. Asking for a bass note that is
     not the root is a different search, not a loosened version of this one:
     dropping the bass rule outright mostly re-admits the same shapes with an
     extra open string underneath. */
  if (options.inversions && parsed.bassPc === null) {
    for (const interval of INVERTIBLE_INTERVALS) {
      if (!parsed.intervals.includes(interval)) continue;

      const bassPc = (parsed.rootPc + interval) % 12;
      if (bassPc === parsed.rootPc) continue;

      const bass = spellNote(bassPc, spellsFlat(interval, parsed.useFlats));
      const found = search(context, bassPc, seen).slice(0, inversionLimit);
      for (const shape of found) {
        results.push({ ...shape, inversion: true, bass, slashName: `${parsed.symbol}/${bass}` });
      }
    }
  }

  return results.map((shape, index) => ({
    ...shape,
    index,
    symbol: parsed.symbol,
    noteNames: shape.frets.map((fret, string) =>
      fret === null ? null : spellNote((tuning[string] + fret) % 12, parsed.useFlats)
    )
  }));
}

function search(context, bassPc, seen) {
  const { parsed, tuning, chordPcs, requiredPcs, perPosition } = context;
  const results = [];

  const curated =
    tuning === STANDARD_TUNING
      ? OPEN_SHAPE_INDEX.get(
          `${parsed.rootPc}|${parsed.quality}|${bassPc === parsed.rootPc ? "" : bassPc}`
        )
      : null;

  if (curated) {
    const shape = describeShape(curated, tuning, parsed.rootPc);
    if (shape) {
      seen.add(fretKey(curated));
      results.push({ ...shape, preferred: true });
    }
  }

  /* Search every four-fret window, then keep only the best shape or two at each
     neck position so clicking through walks up the neck instead of cycling
     through near-identical shapes in first position. */
  const byPosition = new Map();

  for (let base = 0; base <= MAX_FRET - FRET_SPAN; base += 1) {
    walk(buildStringOptions(tuning, chordPcs, base), 0, [], (frets) => {
      const key = fretKey(frets);
      if (seen.has(key)) return;

      const shape = evaluateShape(frets, tuning, requiredPcs, bassPc, parsed.rootPc, chordPcs.size);
      if (!shape) return;

      seen.add(key);
      const bucket = byPosition.get(shape.position);
      if (bucket) bucket.push(shape);
      else byPosition.set(shape.position, [shape]);
    });
  }

  for (const [position, bucket] of [...byPosition.entries()].sort((a, b) => a[0] - b[0])) {
    if (curated && position === results[0]?.position) continue;
    bucket.sort((a, b) => a.score - b.score);
    results.push(...bucket.slice(0, perPosition));
  }

  results.sort(
    (a, b) =>
      Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)) ||
      a.position - b.position ||
      a.score - b.score
  );
  return results;
}

function buildStringOptions(tuning, chordPcs, base) {
  const low = base === 0 ? 0 : base;
  const high = base + FRET_SPAN;

  return tuning.map((openNote) => {
    const choices = [null];
    if (base > 0 && chordPcs.has(openNote % 12)) choices.push(0);
    for (let fret = low; fret <= high; fret += 1) {
      if (chordPcs.has((openNote + fret) % 12)) choices.push(fret);
    }
    return choices;
  });
}

function walk(optionsPerString, stringIndex, current, emit) {
  if (stringIndex === optionsPerString.length) {
    emit(current.slice());
    return;
  }
  for (const choice of optionsPerString[stringIndex]) {
    current.push(choice);
    walk(optionsPerString, stringIndex + 1, current, emit);
    current.pop();
  }
}

function evaluateShape(frets, tuning, requiredPcs, bassPc, rootPc, chordSize) {
  const sounded = [];
  for (let string = 0; string < frets.length; string += 1) {
    if (frets[string] !== null) sounded.push(string);
  }

  const minStrings = chordSize <= 2 ? 3 : 4;
  if (sounded.length < minStrings) return null;

  /* No muted strings sandwiched between sounded ones: those shapes are hard to
     strum cleanly and are not what a songbook wants. */
  for (let string = sounded[0]; string <= sounded[sounded.length - 1]; string += 1) {
    if (frets[string] === null) return null;
  }

  /* Compare pitches, not string numbers. A low string fretted high can sit
     above an open string next to it, so the lowest-numbered sounded string is
     not always the note that actually sounds lowest. */
  let lowest = Infinity;
  for (const string of sounded) lowest = Math.min(lowest, tuning[string] + frets[string]);
  if (lowest % 12 !== bassPc) return null;

  const present = new Set(sounded.map((string) => (tuning[string] + frets[string]) % 12));
  for (const pc of requiredPcs) {
    if (!present.has(pc)) return null;
  }

  return describeShape(frets, tuning, rootPc, present);
}

function describeShape(frets, tuning, rootPc, presentPcs) {
  const hand = fingerShape(frets);
  if (!hand) return null;

  const sounded = [];
  for (let string = 0; string < frets.length; string += 1) {
    if (frets[string] !== null) sounded.push(string);
  }
  if (!sounded.length) return null;

  const present =
    presentPcs || new Set(sounded.map((string) => (tuning[string] + frets[string]) % 12));

  const fretted = sounded.filter((string) => frets[string] > 0);
  const position = fretted.length ? Math.min(...fretted.map((string) => frets[string])) : 0;
  const highest = fretted.length ? Math.max(...fretted.map((string) => frets[string])) : 0;
  const span = fretted.length ? highest - position : 0;
  const muted = frets.length - sounded.length;

  let score = muted * 3 + hand.fingerCount * 1.4 + span * 2 - sounded.length * 0.8;
  if (position <= 1) score -= 2;
  if (!present.has((rootPc + 7) % 12)) score += 0.4;
  if (hand.barre) score += 0.2;
  if (frets[sounded[0]] === 0) score -= 0.5;
  /* An open string ringing under a shape high up the neck is usually a drone
     rather than the voicing someone is looking for. */
  if (position >= 5 && sounded.some((string) => frets[string] === 0)) score += 3;

  return {
    frets,
    fingers: hand.fingers,
    barre: hand.barre,
    fingerCount: hand.fingerCount,
    position,
    span,
    muted,
    score
  };
}

function fretKey(frets) {
  return frets.map((fret) => (fret === null ? "x" : fret)).join("-");
}

/* Works out whether a hand can hold the shape, and which finger goes where.
   Returns null when it needs more than four fingers. */
function fingerShape(frets) {
  const fretted = [];
  for (let string = 0; string < frets.length; string += 1) {
    if (frets[string] > 0) fretted.push({ string, fret: frets[string] });
  }

  const fingers = frets.map((fret) => (fret === null ? null : 0));

  if (!fretted.length) return { fingers, barre: null, fingerCount: 0 };

  const lowestFret = Math.min(...fretted.map((entry) => entry.fret));
  if (Math.max(...fretted.map((entry) => entry.fret)) - lowestFret > FRET_SPAN) return null;

  // Preferred: one finger per note.
  if (fretted.length <= 4) {
    const ordered = [...fretted].sort((a, b) => a.fret - b.fret || a.string - b.string);
    ordered.forEach((entry, index) => {
      fingers[entry.string] = index + 1;
    });
    return { fingers, barre: null, fingerCount: fretted.length };
  }

  // Otherwise try a barre with the index finger at the lowest fret.
  const atLowest = fretted.filter((entry) => entry.fret === lowestFret).map((entry) => entry.string);
  if (atLowest.length < 2) return null;

  const from = Math.min(...atLowest);
  const to = Math.max(...atLowest);
  for (let string = from; string <= to; string += 1) {
    if (frets[string] === null || frets[string] < lowestFret) return null;
  }

  const above = fretted.filter((entry) => entry.fret > lowestFret);
  if (above.length > 3) return null;

  for (let string = from; string <= to; string += 1) {
    if (frets[string] === lowestFret) fingers[string] = 1;
  }
  const ordered = [...above].sort((a, b) => a.fret - b.fret || a.string - b.string);
  ordered.forEach((entry, index) => {
    fingers[entry.string] = index + 2;
  });

  return {
    fingers,
    barre: { fret: lowestFret, from, to },
    fingerCount: 1 + above.length
  };
}

/* The fret the diagram window should start at, and how many frets to draw. */
export function diagramWindow(voicing, fretCount = 5) {
  const fretted = voicing.frets.filter((fret) => fret !== null && fret > 0);
  if (!fretted.length) return { baseFret: 1, fretCount };

  const lowest = Math.min(...fretted);
  const highest = Math.max(...fretted);
  if (highest <= fretCount) return { baseFret: 1, fretCount };
  return { baseFret: Math.max(1, lowest), fretCount };
}
