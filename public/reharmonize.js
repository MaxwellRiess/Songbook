/* Harmonic suggestions are possibilities, not melody analysis. Function-changing
   substitutions are labelled explicitly; the chords either side supply local
   context, and the song's key, when it can be inferred confidently, supplies
   the chord's function.

   None of this reads the tune, so a suggestion can still fight the melody. That
   caveat survives every amount of harmonic context.
   Reference: https://viva.pressbooks.pub/openmusictheory/chapter/substitutions/ */
import { parseChordSymbol, spellNote } from './chord-voicings.js';
import { isDiatonic, keyPitchClasses, romanNumeral, scaleDegree } from './song-key.js';

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

/* The chord each degree carries, in a major key and in a minor one, as the
   offset from the tonic plus the suffix that goes on the root. Degrees are
   indexed by the mode's own scale, the way `scaleDegree` counts them, so a
   mode that flattens a degree says so in its offset: the third degree of a
   minor key sits three semitones above the tonic, not four.

   Both the plain chord and its diatonic seventh are listed, because a
   substitution and a borrowing want different forms. A chord standing in for
   another wants the seventh, which shares more of the notes it is replacing; a
   chord borrowed from the parallel mode wants the plain form it is known by. */
const MODE_CHORDS = {
  major: [
    { at: 0, suffix: '', seventh: 'maj7' },
    { at: 2, suffix: 'm', seventh: 'm7' },
    { at: 4, suffix: 'm', seventh: 'm7' },
    { at: 5, suffix: '', seventh: 'maj7' },
    { at: 7, suffix: '', seventh: '7' },
    { at: 9, suffix: 'm', seventh: 'm7' },
    { at: 11, suffix: 'dim', seventh: 'm7b5' }
  ],
  minor: [
    { at: 0, suffix: 'm', seventh: 'm7' },
    { at: 2, suffix: 'm7b5', seventh: 'm7b5' },
    { at: 3, suffix: '', seventh: 'maj7' },
    { at: 5, suffix: 'm', seventh: 'm7' },
    { at: 7, suffix: 'm', seventh: 'm7' },
    { at: 8, suffix: '', seventh: 'maj7' },
    { at: 10, suffix: '', seventh: '7' }
  ]
};

/* Whether a suggestion reaches for a note outside the key that the chord it
   replaces did not already have.

   Measured against that chord rather than against the scale alone, because a
   chord already sitting outside the key does not thereby make every colour you
   could add to it a chromatic move. A flat third degree in a major key is
   outside it whatever you do, so extending it is still only extending it; what
   counts is whether the suggestion goes further out than the song already was.

   Null when there is no confident key, which is not the same answer as no. */
function reachesOutside(candidate, original, inKey) {
  const scale = keyPitchClasses(inKey);
  if (!scale) return null;
  const already = new Set([...pcs(original)].filter(note => !scale.has(note)));
  return [...pcs(candidate)].some(note => !scale.has(note) && !already.has(note));
}

/* How far a suggestion reaches, in four bands the panel colours by.

   The role says what the suggestion is for. The key then sharpens it, because
   the same move is a smaller step inside the key than outside it, and the role
   alone cannot see that: a raised eleventh is a chromatic reach over the tonic
   and plain lydian colour over the fourth degree, and it only ever adds notes.

   Where the suggestion changes what the progression does, that outranks any
   measurement of its notes: a tritone substitute keeps most of the chord it
   replaces and is still the boldest thing in the list.

   Without a confident key there is nothing to measure against, so the role
   stands on its own: an altered tension and a changed quality both read as the
   middle band, and a moved root as the larger change. */
function reachOf(role, outside) {
  if (role === 'redirect') return 4;
  if (outside === true) return 3;
  if (outside === false) return role === 'colour' || role === 'tension' ? 1 : 2;
  return role === 'colour' ? 1 : role === 'substitute' ? 3 : 2;
}

/* Said in the accessible name and the tooltip, because the band itself is
   carried by colour and colour cannot be the whole message. Two wordings,
   since the bands mean something sharper once the key is known. */
const REACH_WORDS = {
  1: 'gentler colour, adds notes only',
  2: 'a substitution that stays in the key',
  3: 'reaches outside the key',
  4: 'changes where the progression goes'
};
const REACH_WORDS_WITHOUT_KEY = {
  1: 'gentler colour, adds notes only',
  2: 'bolder change, same root',
  3: 'boldest change, new root',
  4: 'changes where the progression goes'
};

/* The same four bands in a word or two, for the filter chips. A row has room
   to say what it is; a chip has room only to be picked out of four. */
const REACH_CHIPS = {
  1: 'Colour',
  2: 'In key',
  3: 'Outside',
  4: 'Redirect'
};
const REACH_CHIPS_WITHOUT_KEY = {
  1: 'Colour',
  2: 'Same root',
  3: 'New root',
  4: 'Redirect'
};

/* `keyed` says whether the suggestions were measured against a confident key,
   which is what the middle two bands mean something different about. */
export function reachChip(strength, keyed) {
  return (keyed ? REACH_CHIPS : REACH_CHIPS_WITHOUT_KEY)[strength] || '';
}

/* Suggestions that come from the shape the chord sits in rather than from the
   chord or its degree.

   `describeProgression` already recognises a chord repeated, a two-five-one, a
   dominant sidestepping to the sixth degree, and a dominant of whatever
   follows. Until now all of that only ever changed the wording of one
   sentence. Each shape asks for something different, and these are the things
   a player reaches for in each.

   A repeated chord is the clearest case. It is asking for movement, and the
   cheapest movement is under a chord that does not change at all, so the same
   chord over its own third or fifth comes first. */
function progressionSuggestions(add, { original, shape, next, nextChord }) {
  if (!shape) return;

  /* The diminished a semitone below a chord leans up into it, with no root of
     its own to commit to. It earns its place wherever the next chord is the
     point of the bar, which is what these shapes have in common. */
  const leadingDiminished = (target, why) => {
    if (!target) return;
    const name = `${spellNote(target.rootPc + 11, false)}dim7`;
    add(name, `Lean into ${target.symbol}`, `${name} sits a semitone under ${target.symbol} and leans up into it. ${why}`, 'redirect');
  };

  if (shape.repeated) {
    /* Only from root position. A chord already written over a bass note has
       had this decision made for it, and stacking a second slash on top of the
       first would not say anything. */
    if (original.bassPc === null) {
      const bare = original.symbol.split('/')[0];
      for (const [steps, degree] of [[[3, 4], 'third'], [[7], 'fifth']]) {
        const interval = steps.find(step => original.intervals.includes(step));
        if (interval === undefined) continue;
        const bass = noteName(original, (original.rootPc + interval) % 12);
        if (!bass) continue;
        add(`${bare}/${bass}`, `Over its ${degree}`,
          `The same chord with ${bass} underneath, so the bass moves while the harmony holds. The cheapest answer to a chord played twice.`);
      }
    }
    /* The other answer to a static chord is an inner voice that walks while
       the rest holds. The chord itself is in the list already; what the repeat
       adds is the reason for reaching for it. */
    const third = original.intervals.includes(3) ? 'm' : original.intervals.includes(4) ? '' : null;
    if (third !== null) {
      const name = `${original.root}${third === 'm' ? 'mmaj7' : 'maj7'}`;
      add(name, 'Line cliché', `Raises the seventh over a root that stays put, the step a descending inner line takes on a chord held for two bars. ${original.symbol} → ${name} → ${original.root}${third}7.`, 'shade');
    }
    leadingDiminished(next, 'On a chord played twice, the second one can lean out of the bar instead of sitting in it.');
  }

  if (shape.twoFiveOne) {
    leadingDiminished(next, 'The dominant without its root, which is the same tension arriving on a different bass.');
  }

  if (shape.deceptive) {
    leadingDiminished(next, 'It leans into the sixth degree rather than declining to land on the tonic, so the sidestep is heard as an arrival.');
  }

  /* A dominant of whatever follows can be stepped through instead of arrived
     on. Only one chord fits where one chord was, so this is the second degree
     of the target standing in its place: the arrival is softened rather than
     set up harder. */
  if (shape.secondaryDominant && next) {
    const minorTarget = next.intervals.includes(3);
    const name = `${spellNote(next.rootPc + 2, next.useFlats)}${minorTarget ? 'm7b5' : 'm7'}`;
    add(name, `Delay ${next.symbol}`, `The second degree of ${next.symbol}, where its dominant was. The bar leans toward ${nextChord} without announcing it, which leaves the arrival softer.`, 'substitute');
  }
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const ordinal = degree => ORDINALS[degree - 1] || `${degree}th`;

/* Suggestions that come from what the chord is doing in the key rather than
   from what the chord is.

   The quality table below can only ever offer the same root dressed
   differently, plus a couple of fixed intervals away from it, because a chord
   read on its own carries no function to substitute for. Once the key is known
   the degree does carry one, and two rules cover most of what players actually
   reach for.

   A chord a third away shares two of its three notes, so the key's own chord
   on the degree above or below stands in for this one without argument. And
   the same degree taken from the parallel mode is the whole borrowed-chord
   vocabulary in one rule: on the degrees of a major key it gives i, iiø, bIII,
   iv, v, bVI and bVII, which is the list a player would name.

   The borrowing only runs both ways on the degrees where it is idiomatic. A
   major key borrows from its parallel minor freely. A minor key borrowing from
   major is really only two chords, the raised third of a Picardy close and the
   raised sixth that makes the fourth degree major, so the other degrees are
   left alone rather than offered for the sake of symmetry. */
function functionalSuggestions(add, { original, inKey, degree, next }) {
  if (!inKey) return;
  const flats = inKey.tonic.includes('b') || original.useFlats;
  const parallel = inKey.mode === 'major' ? 'minor' : 'major';
  const here = MODE_CHORDS[inKey.mode];
  const there = MODE_CHORDS[parallel];
  const parallelName = `${inKey.tonic} ${parallel}`;
  /* A degree the parallel mode flattens is written flat, whichever way the key
     itself is spelled: the sixth degree borrowed into A major is F, not E
     sharp. A degree that keeps its root keeps the key's own spelling. */
  const rootAt = (offset, moved) => spellNote(inKey.tonicPc + offset, moved ? true : flats);
  const numeralOf = name => romanNumeral(name, inKey) || name;

  if (degree) {
    const at = degree - 1;
    for (const [step, where] of [[2, 'above'], [5, 'below']]) {
      const entry = here[(at + step) % 7];
      const name = rootAt(entry.at, false) + entry.seventh;
      add(name, `A third ${where}`,
        `${numeralOf(name)} sits a third ${where} ${original.symbol} in ${inKey.name} and keeps most of its notes, so it stands in for it without changing what the bar is doing.`,
        'substitute');
    }

    const borrowable = inKey.mode === 'major' || degree === 1 || degree === 4;
    const entry = there[at];
    if (borrowable && entry) {
      const moved = entry.at !== here[at].at;
      const name = rootAt(entry.at, moved) + entry.suffix;
      add(name, `Borrowed from ${parallelName}`,
        `${numeralOf(name)} is the ${ordinal(degree)} degree of ${parallelName}, standing where ${original.symbol} does in ${inKey.name}. The modal interchange players reach for most.`,
        moved ? 'substitute' : 'shade');
    }
  }

  /* A flattened seventh resolving up to the tonic, which is the way into a
     major tonic that does not go through its dominant. Only worth offering
     where the tonic is actually next. */
  if (inKey.mode === 'major' && next && scaleDegree(next.symbol, inKey) === 1) {
    const name = `${spellNote(inKey.tonicPc + 10, true)}7`;
    add(name, 'Backdoor dominant',
      `${name} leans up into ${next.symbol} from a tone below instead of falling to it from the fifth. The back door into the tonic.`,
      'redirect');
  }

  /* The Neapolitan. A major chord on the flattened second stands in for the
     chords that set up the dominant, which is what the second and fourth
     degrees are doing. */
  if (inKey.mode === 'major' && (degree === 2 || degree === 4)) {
    const name = spellNote(inKey.tonicPc + 1, true);
    add(name, 'Neapolitan',
      `${name} stands in for ${original.symbol} as the chord that sets up the dominant, a semitone above the tonic. Old, and still startling.`,
      'substitute');
  }
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

  /* `role` says what the suggestion is for: `colour` adds notes over the chord,
     `tension` adds an altered one, `shade` changes the chord's quality on the
     same root, `substitute` stands another chord in its place, and `redirect`
     sends the progression somewhere else. `reachOf` turns that into the band
     the panel colours by, once the key has had its say. */
  function add(name, flavor, explanation, role = 'colour') {
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
    /* Two different questions, and the panel asks both. `diatonic` is the flat
       fact about the chord, which is what the detail line states. The band is
       the change this makes to the song, which is the comparison. */
    const diatonic = inKey ? isDiatonic(name, inKey) : null;
    const strength = reachOf(role, reachesOutside(parsed, original, inKey));
    suggestions.push({
      symbol: name, flavor, explanation: explanation + bassNote, role,
      /* How far the change reaches, 1 to 4, measured against the key where
         there is one. The panel colours the options by this rather than
         labelling each one. */
      strength,
      strengthNote: (inKey ? REACH_WORDS : REACH_WORDS_WITHOUT_KEY)[strength],
      numeral: inKey ? romanNumeral(name, inKey) : '',
      diatonic,
      commonNotes: [...tones].filter(n => target.has(n)).map(n => noteName(original, n)),
      addedNotes: [...target].filter(n => !tones.has(n)).map(n => noteName(parsed, n)),
      removedNotes: [...tones].filter(n => !target.has(n)).map(n => noteName(original, n))
    });
  }

  /* Most specific first, so that where a suggestion can be reached more than
     one way it arrives with the explanation that knows the most. The parallel
     minor of a major chord and the fourth degree borrowed from the parallel
     mode are the same chord; only one of them can say why it is that chord. */
  const shape = describeProgression({ prevChord, symbol: original.symbol, nextChord, key });
  progressionSuggestions(add, { original, shape, next, nextChord });
  functionalSuggestions(add, { original, inKey, degree, next });

  if (dominant) {
    add(`${root}9`, 'Bluesy / open', 'Keeps the dominant pull and adds a ninth.');
    add(`${root}13`, 'Full / soulful', 'A dominant color with a sixth above the octave.');
    add(`${root}7sus4`, 'Suspended', 'Replaces the major third with a fourth, softening the resolution.', 'shade');
    add(`${root}7b9`, 'Dark tension', 'Adds a semitone above the root; try it before a minor chord.', 'tension');
    add(`${root}7#9`, 'Grit / bite', 'Combines a major third with a sharp ninth for a blues-inflected clash.', 'tension');
    add(`${root}13#11`, 'Bright tension', 'A raised fourth and thirteenth give the dominant a floating edge.', 'tension');
    add(`${root}7#5`, 'Whole-tone lift', 'Raises the fifth, so the chord loses its footing and leans harder on wherever it goes.', 'tension');
    add(`${root}7b13`, 'Altered / brooding', 'A flattened thirteenth over the dominant, the darkest of the ordinary alterations.', 'tension');
    add(`${root}7alt`, 'Altered, all of it', 'Flattened ninth and thirteenth together over the third and seventh. Everything that can be bent, bent.', 'tension');
    add(`${root}m7`, 'Minor turn', 'Lowers the third, changing the dominant function as well as its color.', 'shade');
    const targetName = next && (next.rootPc-original.rootPc+12)%12 === 5 ? next.symbol : spellNote(original.rootPc+5, true);
    /* Inside a ii-V-I the substitute's point is the bass walking down by
       semitones, which is why players reach for it there. Saying so needs the
       chord before as well as the one after. */
    const previous = parseChordSymbol(prevChord);
    /* Inside a ii-V-I the bass walk says everything the generic line about
       resolving down a semitone says, and says it about this song, so it
       replaces that sentence rather than following it. */
    const resolution = shape?.twoFiveOne && previous
      ? `Inside this ii–V–I the bass walks ${previous.root} → ${spellNote(original.rootPc+6, true)} → ${next.root}.`
      : `Strongest when resolving down a semitone to ${targetName}.`;
    add(`${spellNote(original.rootPc+6,true)}7`, 'Tritone substitute', `Shares the third/seventh pitch classes with ${root}7. ${resolution}`, 'redirect');
  } else if (diminished) {
    add(`${root}m7b5`, 'Half diminished', 'A softer diminished color with a minor seventh.');
    add(`${root}dim7`, 'Symmetric tension', 'A fully diminished seventh adds tightly spaced tension.', 'shade');
    add(`${root}m7`, 'Soften the fifth', 'Raises the diminished fifth for a more settled minor sound.', 'shade');
    add(`${root}m9`, 'Open minor', 'Raises the fifth and adds a ninth; changes the original function.', 'shade');
    /* A diminished seventh is a dominant seventh flat ninth without its root,
       so the dominant a major third below it is the chord it was standing in
       for all along. Putting the root back states it outright. */
    add(`${spellNote(original.rootPc + 8, true)}7b9`, 'Give it a root',
      `${spellNote(original.rootPc + 8, true)}7b9 is this chord with a root underneath it. The tension is the same; the bass names where it is going.`, 'redirect');
  } else if (minor) {
    add(`${root}m7`, 'Soft / intimate', 'Adds a minor seventh while keeping the minor triad.');
    add(`${root}m9`, 'Deep / mellow', 'Adds seventh and ninth colors around the minor third.');
    add(`${root}m11`, 'Spacious', 'Adds a fourth above the octave to the minor ninth color.');
    add(`${root}m6`, 'Bittersweet', 'The natural sixth gives minor a lighter, unsettled warmth.');
    add(`${root}m13`, 'Wide minor', 'A natural thirteenth over the minor seventh, the sixth kept up where it does not crowd the third.');
    add(`${root}madd9`, 'Bare / ringing', 'A ninth over the minor triad with no seventh under it, so the chord stays open.');
    add(`${root}m7b5`, 'Hollowed out', 'Drops the fifth a semitone, taking the floor out from under the minor chord.', 'shade');
    add(root, 'Major instead', 'Raises the minor third for a sudden lift. Check it against the melody.', 'shade');
    add(`${root}maj9`, 'Luminous major', 'Changes to major and adds a major seventh and ninth.', 'shade');
    add(`${root}mmaj7`, 'Cinematic tension', 'Keeps the minor third but raises the seventh.', 'shade');
    /* Without a key there is no degree to reason from, so the chord a minor
       third above is offered on the interval alone. With one, the third
       relations above have already covered it, and covered it better. */
    if (!inKey) {
      add(`${spellNote(original.rootPc+3,original.useFlats)}maj7`, 'Relative-major color', 'Moves the root up a minor third, keeping common tones but changing the bass and emphasis.', 'substitute');
    }
  } else if (major) {
    add(`${root}add9`, 'Open / gentle', 'Adds a ninth without introducing a seventh.');
    add(`${root}maj7`, 'Warm / wistful', 'Adds a major seventh close to the root.');
    add(`${root}maj9`, 'Lush', 'Layers a ninth over the major-seventh color.');
    add(`${root}69`, 'Easy / rounded', 'Adds sixth and ninth colors without a leading-tone seventh.');
    add(`${root}6`, 'Plain sixth', 'A sixth and nothing else, which settles where a major seventh would lean.');
    add(`${root}maj13`, 'Full major', 'A thirteenth stacked over the major ninth, about as wide as the chord goes.');
    add(`${root}sus2`, 'Open second', 'A second in place of the third, thinner than the fourth and less impatient.', 'shade');
    add(`${root}maj9#11`, 'Floating', 'A raised fourth adds a luminous edge to the major ninth.', 'tension');
    add(`${root}sus4`, 'Held back', 'A fourth in place of the third, so the chord states no third at all until it moves.', 'shade');
    add(`${root}aug`, 'Raised fifth', 'Raises the fifth a semitone. Nothing sits still on it, which is the point.', 'shade');
    add(`${root}m`, 'Minor instead', 'Lowers the third for a darker parallel-minor turn. Check the melody.', 'shade');
    add(`${root}m9`, 'Rich minor', 'Combines the minor-third change with a seventh and ninth.', 'shade');
    if (!inKey) {
      add(`${spellNote(original.rootPc+9,original.useFlats)}m7`, 'Relative-minor color', 'Moves the root down a minor third, keeping common tones with a new bass emphasis.', 'substitute');
    }
    /* A flat seventh on the tonic or the fourth is outside the major scale, so
       neither can be offered without knowing which degree the chord is. */
    /* The added note is named by the panel from the new chord's own spelling,
       so it is not named again here, and the degree line already says the note
       is outside the key. */
    if (inKey?.mode === 'major' && degree === 1) {
      add(`${root}7`, 'Blues seventh', 'Adds the flat seventh, which pulls toward the fourth. The blues and gospel tonic.', 'tension');
    }
    if (inKey?.mode === 'major' && degree === 4) {
      add(`${root}7`, 'Blues seventh on IV', 'Adds the flat seventh, a common colour on the fourth that leans back toward the tonic.', 'tension');
    }
  } else {
    add(`${root}add9`, 'Clear major', 'Introduces a major third with an open ninth.', 'shade');
    add(`${root}m9`, 'Soft minor', 'Introduces a minor third, seventh and ninth.', 'shade');
    add(`${root}sus2`, 'Airy', 'An open second replaces the third.');
    add(`${root}sus4`, 'Suspended', 'A fourth replaces the third.');
    add(`${root}7`, 'Bluesy third', 'Commits to a major third and a flat seventh, which a chord stating no third leaves open.', 'shade');
  }
  if (next) {
    const leadRoot = spellNote(next.rootPc+7, next.useFlats);
    add(`${leadRoot}7`, `Lead to ${next.symbol}`, `A dominant of the next chord, ${next.symbol}. Changes the progression to create a stronger arrival.`, 'redirect');
    /* The same pull, arriving from a semitone above instead of a fifth above.
       The chord already offers this from its own root when it is a dominant;
       here it is offered from the next chord's, so any chord at all can have
       one. */
    if (!dominant) {
      const slideRoot = spellNote(next.rootPc+1, true);
      add(`${slideRoot}7`, `Slide into ${next.symbol}`, `Shares its third and seventh with the dominant of ${next.symbol} and slides down a semitone into it. The tritone substitute, taken from this side.`, 'redirect');
    }
  }

  const wasInto = prevChord ? transition(prevChord, original.symbol) : null;
  const wasOutOf = nextChord ? transition(original.symbol, nextChord) : null;
  for (const candidate of suggestions) {
    candidate.into = prevChord ? transition(prevChord, candidate.symbol) : null;
    candidate.outOf = nextChord ? transition(candidate.symbol, nextChord) : null;
    candidate.rubs = (candidate.into?.rubs || 0) + (candidate.outOf?.rubs || 0);
    candidate.carried = (candidate.into?.shared || 0) + (candidate.outOf?.shared || 0);
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
