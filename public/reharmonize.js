/* Harmonic suggestions are possibilities, not melody analysis. Function-changing
   substitutions are labelled explicitly; the next chord supplies local context.
   Reference: https://viva.pressbooks.pub/openmusictheory/chapter/substitutions/ */
import { parseChordSymbol, spellNote } from './chord-voicings.js';

const pcs = chord => new Set(chord.intervals.map(n => (chord.rootPc + n) % 12));
const sameSet = (a, b) => a.size === b.size && [...a].every(n => b.has(n));
const noteName = (chord, pc) => chord.notes[chord.intervals.findIndex(n => (chord.rootPc + n) % 12 === pc)];

export function suggestReharmonizations(symbol, { nextChord = '' } = {}) {
  const original = parseChordSymbol(symbol);
  if (!original) return [];
  const next = parseChordSymbol(nextChord);
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
    add(`${spellNote(original.rootPc+6,true)}7`, 'Tritone substitute', `Shares the third/seventh pitch classes with ${root}7. Strongest when resolving down a semitone to ${targetName}.`, true);
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
  return suggestions;
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
