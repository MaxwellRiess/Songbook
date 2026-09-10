/* Chords that lead into the one you clicked.

   Informational only. Nothing here is applied to the sheet, and that is a
   deliberate limit rather than an unfinished one: the app stores chords by the
   character column they sit above and knows nothing about how long any of them
   lasts, so it cannot say whether a passing chord takes half the bar or one
   beat of it. Showing an approach and letting you hear it resolve costs none of
   that, and a player can put it where their ear says it goes.

   Kept free of the DOM so the harmony can be tested on its own. */

import { parseChordSymbol, spellNote } from "./chord-voicings.js";

/* Function decides the spelling, not the target chord's own preference. A chord
   a semitone above is a flattened second and is written flat; a diminished a
   semitone below is the raised seventh leading up, and is written sharp. */
const above = (chord, steps, useFlats = chord.useFlats) => spellNote((chord.rootPc + steps) % 12, useFlats);

function thirdOf(chord) {
  const steps = new Set(chord.intervals.map((step) => step % 12));
  if (steps.has(4) && steps.has(10)) return "dominant";
  if (steps.has(3) && steps.has(6)) return "diminished";
  if (steps.has(3)) return "minor";
  if (steps.has(4)) return "major";
  return "neutral";
}

/* Returns the ways into `symbol`, each as one or two chords plus what it does.
   `prevChord` is only used to say when the song already does this. */
export function suggestApproaches(symbol, { prevChord = "" } = {}) {
  const target = parseChordSymbol(symbol);
  if (!target) return [];

  const minorTarget = thirdOf(target) === "minor" || thirdOf(target) === "diminished";
  const fifth = `${above(target, 7)}7`;
  /* A minor target takes a half-diminished second degree, which is the minor
     two-five rather than the major one. */
  const second = minorTarget ? `${above(target, 2)}m7b5` : `${above(target, 2)}m7`;

  const approaches = [
    {
      chords: [fifth],
      label: `Dominant of ${target.symbol}`,
      explanation: `${fifth} is a fifth above ${target.symbol}, so it pulls straight into it. The plainest way in.`
    },
    {
      chords: [second, fifth],
      label: `Two-five into ${target.symbol}`,
      explanation: `${second} then ${fifth}${minorTarget ? ", the minor two-five," : ","} steps through the dominant instead of arriving on it. Needs room for two chords.`
    },
    {
      chords: [`${above(target, 1, true)}7`],
      label: "A semitone above",
      explanation: `${above(target, 1, true)}7 shares its third and seventh with ${fifth}, and slides down a semitone into ${target.symbol}. The tritone substitute, heard from the other side.`
    },
    {
      chords: [`${above(target, 11, false)}dim7`],
      label: "A semitone below",
      explanation: `${above(target, 11, false)}dim7 leans up into ${target.symbol}. Tightly spaced tension with no root of its own to commit to.`
    }
  ];

  const already = parseChordSymbol(prevChord);
  return approaches
    .filter((approach) => approach.chords.every((chord) => parseChordSymbol(chord)))
    .map((approach) => ({
      ...approach,
      /* Worth saying when the song already does this, so the list reads as
         confirmation rather than as a suggestion to change something. */
      alreadyThere: Boolean(already) && approach.chords.length === 1 &&
        parseChordSymbol(approach.chords[0]).rootPc === already.rootPc &&
        thirdOf(parseChordSymbol(approach.chords[0])) === thirdOf(already)
    }));
}
