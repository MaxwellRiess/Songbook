/* Harmonic suggestions are possibilities, not melody analysis. Function-changing
   substitutions are labelled explicitly; the chords either side supply local
   context, and the song's key, when it can be inferred confidently, supplies
   the chord's function.

   None of this reads the tune, so a suggestion can still fight the melody. That
   caveat survives every amount of harmonic context.
   Reference: https://viva.pressbooks.pub/openmusictheory/chapter/substitutions/ */
import { parseChordSymbol, spellNote } from './chord-voicings.js';
import { isDiatonic, romanNumeral, scaleDegree } from './song-key.js';

const pcs = chord => new Set(chord.intervals.map(n => (chord.rootPc + n) % 12));
const sameSet = (a, b) => a.size === b.size && [...a].every(n => b.has(n));
const noteName = (chord, pc) => chord.notes[chord.intervals.findIndex(n => (chord.rootPc + n) % 12 === pc)];

/* Voice leading across one transition.

   Two things a player can feel. How many notes carry over, which is smoothness.
   And cross relations: the same letter appearing in two chromatic forms a beat
   apart, C then C sharp, or E then E flat. That, not any semitone at all, is
   what rubs. A plain semitone between successive chords is ordinary voice
   leading and often the whole point, so E moving to F from a fourth chord back
   to the tonic is left alone. */
export function transition(fromSymbol, toSymbol) {
  const from = parseChordSymbol(fromSymbol);
  const to = parseChordSymbol(toSymbol);
  if (!from || !to) return null;
  const fromNotes = pcs(from);
  const toNotes = pcs(to);
  const shared = [...toNotes].filter(note => fromNotes.has(note));

  const letters = new Map();
  for (const note of fromNotes) {
    const name = noteName(from, note);
    if (name) letters.set(name[0], { name, note });
  }
  const crossRelations = [];
  for (const note of toNotes) {
    const name = noteName(to, note);
    if (!name) continue;
    const before = letters.get(name[0]);
    if (before && before.note !== note) crossRelations.push({ was: before.name, becomes: name });
  }

  return {
    shared: shared.length,
    sharedNotes: shared.map(note => noteName(to, note)),
    rubs: crossRelations.length,
    crossRelations
  };
}

/* Names the shape the chord sits in, when it makes one. Returns a short label
   for the panel's header and a flag or two the suggestions can lean on. */
export function describeProgression({ prevChord = '', symbol = '', nextChord = '', key = null } = {}) {
  const inKey = key?.confident ? key : null;
  const here = parseChordSymbol(symbol);
  if (!here) return null;
  const before = parseChordSymbol(prevChord);
  const after = parseChordSymbol(nextChord);
  const isDominant = chord => {
    const steps = new Set(chord.intervals.map(n => n % 12));
    return steps.has(4) && steps.has(10);
  };
  const fifthAbove = (from, to) => to && from && (from.rootPc - to.rootPc + 12) % 12 === 7;

  if (before && here.rootPc === before.rootPc && sameSet(pcs(here), pcs(before))) {
    return { label: 'the same chord again', repeated: true };
  }
  if (inKey && before && after) {
    const degrees = [prevChord, symbol, nextChord].map(chord => scaleDegree(chord, inKey));
    if (degrees[0] === 2 && degrees[1] === 5 && degrees[2] === 1) {
      return { label: 'ii–V–I', twoFiveOne: true, target: after.symbol };
    }
  }
  if (inKey && after && isDominant(here) && scaleDegree(symbol, inKey) === 5 && scaleDegree(nextChord, inKey) === 6) {
    return { label: 'V–vi, the resolution withheld', deceptive: true };
  }
  if (after && isDominant(here) && fifthAbove(here, after)) {
    return { label: `dominant of ${after.symbol}`, secondaryDominant: true, target: after.symbol };
  }
  return null;
}

export function suggestReharmonizations(symbol, { prevChord = '', nextChord = '', key = null } = {}) {
  const original = parseChordSymbol(symbol);
  if (!original) return [];
  const next = parseChordSymbol(nextChord);
  // Function-based suggestions and labels only run on a key the inference was
  // confident about; a wrong numeral stated plainly is worse than none.
  const inKey = key?.confident ? key : null;
  const degree = inKey ? scaleDegree(original.symbol, inKey) : 0;
  const tones = pcs(original);
  const intervals = new Set(original.intervals.map(n => n % 12));
  const dominant = intervals.has(4) && intervals.has(10);
  const minor = intervals.has(3) && !intervals.has(4);
  const major = intervals.has(4) && !dominant;
  const diminished = intervals.has(3) && intervals.has(6);
  const suggestions = [];
  const seen = new Set();
  const root = original.root;

  function add(name, flavor, explanation, bold = false) {
    let parsed = parseChordSymbol(name);
    if (!parsed) return;
    let bassNote = '';
    // Preserve an inversion when its bass belongs to the new harmony.
    if (original.bassPc !== null) {
      if (pcs(parsed).has(original.bassPc)) {
        if (parsed.rootPc !== original.bassPc) name += `/${original.bass}`;
      } else {
        bassNote = ` Bass changes from ${original.bass} to ${parsed.root}.`;
      }
    }
    parsed = parseChordSymbol(name);
    const target = pcs(parsed);
    if (sameSet(tones, target) && (original.bassPc ?? original.rootPc) === (parsed.bassPc ?? parsed.rootPc)) return;
    const key = [...target].sort((a,b) => a-b).join(',') + ':' + (parsed.bassPc ?? parsed.rootPc);
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({
      symbol: name, flavor, explanation: explanation + bassNote, bold,
      /* How far the change reaches: 1 only adds notes, 2 changes the chord's
         quality or function over the same root, 3 moves the root as well. The
         panel colours the options by this rather than labelling each one. */
      strength: bold ? (parsed.rootPc === original.rootPc ? 2 : 3) : 1,
      commonNotes: [...tones].filter(n => target.has(n)).map(n => noteName(original, n)),
      addedNotes: [...target].filter(n => !tones.has(n)).map(n => noteName(parsed, n)),
      removedNotes: [...tones].filter(n => !target.has(n)).map(n => noteName(original, n))
    });
  }

  if (dominant) {
    add(`${root}9`, 'Bluesy / open', 'Keeps the dominant pull and adds a ninth.');
    add(`${root}13`, 'Full / soulful', 'A dominant color with a sixth above the octave.');
    add(`${root}7sus4`, 'Suspended', 'Replaces the major third with a fourth, softening the resolution.');
    add(`${root}7b9`, 'Dark tension', 'Adds a semitone above the root; try it before a minor chord.', true);
    add(`${root}7#9`, 'Grit / bite', 'Combines a major third with a sharp ninth for a blues-inflected clash.', true);
    add(`${root}13#11`, 'Bright tension', 'A raised fourth and thirteenth give the dominant a floating edge.', true);
    add(`${root}m7`, 'Minor turn', 'Lowers the third, changing the dominant function as well as its color.', true);
    const targetName = next && (next.rootPc-original.rootPc+12)%12 === 5 ? next.symbol : spellNote(original.rootPc+5, true);
    /* Inside a ii-V-I the substitute's point is the bass walking down by
       semitones, which is why players reach for it there. Saying so needs the
       chord before as well as the one after. */
    const shape = describeProgression({ prevChord, symbol, nextChord, key });
    const previous = parseChordSymbol(prevChord);
    /* Inside a ii-V-I the bass walk says everything the generic line about
       resolving down a semitone says, and says it about this song, so it
       replaces that sentence rather than following it. */
    const resolution = shape?.twoFiveOne && previous
      ? `Inside this ii–V–I the bass walks ${previous.root} → ${spellNote(original.rootPc+6, true)} → ${next.root}.`
      : `Strongest when resolving down a semitone to ${targetName}.`;
    add(`${spellNote(original.rootPc+6,true)}7`, 'Tritone substitute', `Shares the third/seventh pitch classes with ${root}7. ${resolution}`, true);
  } else if (diminished) {
    add(`${root}m7b5`, 'Half diminished', 'A softer diminished color with a minor seventh.');
    add(`${root}dim7`, 'Symmetric tension', 'A fully diminished seventh adds tightly spaced tension.', true);
    add(`${root}m7`, 'Soften the fifth', 'Raises the diminished fifth for a more settled minor sound.', true);
    add(`${root}m9`, 'Open minor', 'Raises the fifth and adds a ninth; changes the original function.', true);
  } else if (minor) {
    add(`${root}m7`, 'Soft / intimate', 'Adds a minor seventh while keeping the minor triad.');
    add(`${root}m9`, 'Deep / mellow', 'Adds seventh and ninth colors around the minor third.');
    add(`${root}m11`, 'Spacious', 'Adds a fourth above the octave to the minor ninth color.');
    add(`${root}m6`, 'Bittersweet', 'The natural sixth gives minor a lighter, unsettled warmth.');
    add(root, 'Major instead', 'Raises the minor third for a sudden lift. Check it against the melody.', true);
    add(`${root}maj9`, 'Luminous major', 'Changes to major and adds a major seventh and ninth.', true);
    add(`${root}mmaj7`, 'Cinematic tension', 'Keeps the minor third but raises the seventh.', true);
    add(`${spellNote(original.rootPc+3,original.useFlats)}maj7`, 'Relative-major color', 'Moves the root up a minor third, keeping common tones but changing the bass and emphasis.', true);
  } else if (major) {
    add(`${root}add9`, 'Open / gentle', 'Adds a ninth without introducing a seventh.');
    add(`${root}maj7`, 'Warm / wistful', 'Adds a major seventh close to the root.');
    add(`${root}maj9`, 'Lush', 'Layers a ninth over the major-seventh color.');
    add(`${root}69`, 'Easy / rounded', 'Adds sixth and ninth colors without a leading-tone seventh.');
    add(`${root}maj9#11`, 'Floating', 'A raised fourth adds a luminous edge to the major ninth.', true);
    add(`${root}m`, 'Minor instead', 'Lowers the third for a darker parallel-minor turn. Check the melody.', true);
    add(`${root}m9`, 'Rich minor', 'Combines the minor-third change with a seventh and ninth.', true);
    add(`${spellNote(original.rootPc+9,original.useFlats)}m7`, 'Relative-minor color', 'Moves the root down a minor third, keeping common tones with a new bass emphasis.', true);
    /* A flat seventh on the tonic or the fourth is outside the major scale, so
       neither can be offered without knowing which degree the chord is. */
    /* The added note is named by the panel from the new chord's own spelling,
       so it is not named again here, and the degree line already says the note
       is outside the key. */
    if (inKey?.mode === 'major' && degree === 1) {
      add(`${root}7`, 'Blues seventh', 'Adds the flat seventh, which pulls toward the fourth. The blues and gospel tonic.', true);
    }
    if (inKey?.mode === 'major' && degree === 4) {
      add(`${root}7`, 'Blues seventh on IV', 'Adds the flat seventh, a common colour on the fourth that leans back toward the tonic.', true);
    }
  } else {
    add(`${root}add9`, 'Clear major', 'Introduces a major third with an open ninth.', true);
    add(`${root}m9`, 'Soft minor', 'Introduces a minor third, seventh and ninth.', true);
    add(`${root}sus2`, 'Airy', 'An open second replaces the third.');
    add(`${root}sus4`, 'Suspended', 'A fourth replaces the third.');
  }
  if (next) {
    const leadRoot = spellNote(next.rootPc+7, next.useFlats);
    add(`${leadRoot}7`, `Lead to ${next.symbol}`, `A dominant of the next chord, ${next.symbol}. Changes the progression to create a stronger arrival.`, true);
  }

  const shape = describeProgression({ prevChord, symbol: original.symbol, nextChord, key });
  const wasInto = prevChord ? transition(prevChord, original.symbol) : null;
  const wasOutOf = nextChord ? transition(original.symbol, nextChord) : null;
  for (const candidate of suggestions) {
    candidate.into = prevChord ? transition(prevChord, candidate.symbol) : null;
    candidate.outOf = nextChord ? transition(candidate.symbol, nextChord) : null;
    candidate.rubs = (candidate.into?.rubs || 0) + (candidate.outOf?.rubs || 0);
    candidate.carried = (candidate.into?.shared || 0) + (candidate.outOf?.shared || 0);
    candidate.numeral = inKey ? romanNumeral(candidate.symbol, inKey) : '';
    candidate.diatonic = inKey ? isDiatonic(candidate.symbol, inKey) : null;
    candidate.transitionNote = describeTransition(candidate, { prevChord, nextChord, wasInto, wasOutOf, original });
    candidate.progression = shape;
  }

  /* Gentler colours first, so the panel's tint ramp reads in order, then the
     options that introduce a cross relation last inside each band. The sort is
     stable and the tie-breaker is zero without neighbours, so the hand-written
     order survives wherever there is nothing to separate two suggestions. */
  suggestions.sort((one, other) =>
    one.strength - other.strength ||
    one.rubs - other.rubs);

  return suggestions;
}

/* One sentence at most, and only when there is something a player would want
   warning about or pointing out. A cross relation is worth more than a smooth
   join, and one that the original chord already has is not this suggestion's
   doing, so it is not reported against it. */
function describeTransition(candidate, { prevChord, nextChord, wasInto, wasOutOf, original }) {
  const newInto = fresh(candidate.into, wasInto);
  if (newInto) return `${newInto.becomes} contradicts the ${newInto.was} in ${prevChord} just before it.`;
  const newOutOf = fresh(candidate.outOf, wasOutOf);
  if (newOutOf) return `Its ${newOutOf.was} is contradicted by the ${newOutOf.becomes} in ${nextChord}.`;
  /* Sharing more notes than the original mostly just means having more notes,
     so it is not worth saying. Clearing a cross relation the original has is,
     because it answers a rub the player can already hear. */
  const clearedInto = fresh(wasInto, candidate.into);
  if (clearedInto) return `Settles the ${clearedInto.was} against ${clearedInto.becomes} that ${original.symbol} has with ${prevChord}.`;
  const clearedOutOf = fresh(wasOutOf, candidate.outOf);
  if (clearedOutOf) return `Settles the ${clearedOutOf.was} against ${clearedOutOf.becomes} that ${original.symbol} has with ${nextChord}.`;
  return '';
}

/* The first cross relation this suggestion introduces that the original chord
   did not already have. */
function fresh(now, before) {
  if (!now?.crossRelations.length) return null;
  const already = new Set((before?.crossRelations || []).map(pair => `${pair.was}>${pair.becomes}`));
  return now.crossRelations.find(pair => !already.has(`${pair.was}>${pair.becomes}`)) || null;
}

/* A draft is tied to both song identity and source text, so editing or syncing a
   changed sheet cannot silently apply occurrence numbers to different chords. */
export class ReharmonizationDrafts {
  constructor() { this.songs = new Map(); }
  forSong(song) {
    if (!song) return new Map();
    let draft = this.songs.get(song.id);
    if (!draft || draft.source !== song.rawContent) {
      draft = { source: song.rawContent, chords: new Map() };
      this.songs.set(song.id, draft);
    }
    return draft.chords;
  }
}
