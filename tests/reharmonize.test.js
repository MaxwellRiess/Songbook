import assert from 'node:assert/strict';
import test from 'node:test';
import { describeProgression, reachChip, suggestReharmonizations, transition, ReharmonizationDrafts } from '../public/reharmonize.js';
import { inferKey } from '../public/song-key.js';
import { parseChordSymbol } from '../public/chord-voicings.js';

const names = (chord, context) => suggestReharmonizations(chord, context).map(item => item.symbol);

test('offers parallel major/minor changes and rich extensions', () => {
  for (const name of ['Cm', 'Cm9', 'Cmaj9', 'Cmaj9#11', 'Am7']) assert.ok(names('C').includes(name), name);
  for (const name of ['A', 'Amaj9', 'Am11', 'Ammaj7', 'Cmaj7']) assert.ok(names('Am').includes(name), name);
  assert.equal(suggestReharmonizations('C').find(item => item.symbol === 'Cm').role, 'shade');
});

test('describes the actual note changes for parallel minor', () => {
  const option = suggestReharmonizations('C').find(item => item.symbol === 'Cm');
  assert.deepEqual(option.commonNotes, ['C', 'G']);
  assert.deepEqual(option.removedNotes, ['E']);
  assert.deepEqual(option.addedNotes.map(note => parseChordSymbol(note).rootPc), [3]);
});

test('tritone substitutions retain dominant guide tones and name the resolution', () => {
  const option = suggestReharmonizations('G7', { nextChord: 'Cm' }).find(item => item.flavor === 'Tritone substitute');
  assert.equal(option.symbol, 'Db7');
  assert.match(option.explanation, /to Cm/);
  assert.deepEqual(option.commonNotes.map(note => parseChordSymbol(note).rootPc).sort((a,b) => a-b), [5, 11]);
  assert.ok(!suggestReharmonizations('G').some(item => item.flavor === 'Tritone substitute'));
});

test('uses the next chord for a local dominant approach', () => {
  assert.ok(names('C', {nextChord: 'Am'}).includes('E7'));
  assert.ok(!names('C').includes('E7'));
});

test('keeps a slash bass where compatible and explains a changed bass', () => {
  const options = suggestReharmonizations('C/E');
  assert.ok(options.some(item => item.symbol === 'Cmaj9/E'));
  assert.match(options.find(item => item.symbol === 'Cm').explanation, /Bass changes from E to C/);
  assert.ok(names('C/G').includes('Cm/G'));
});

test('all families produce distinct, valid harmonies without repeating the original', () => {
  for (const symbol of ['C', 'Am9', 'F#13', 'Bbmaj7', 'Dm7b5', 'Bdim7', 'Dsus4', 'E5', 'C/E', 'G7#9']) {
    const key = chord => [...new Set(chord.intervals.map(n => (chord.rootPc+n)%12))].sort((a,b) => a-b).join(',') + ':' + (chord.bassPc ?? chord.rootPc);
    const original = key(parseChordSymbol(symbol));
    const seen = new Set();
    for (const option of suggestReharmonizations(symbol)) {
      const parsed = parseChordSymbol(option.symbol);
      assert.ok(parsed, option.symbol);
      assert.notEqual(key(parsed), original);
      assert.ok(!seen.has(key(parsed)), option.symbol);
      seen.add(key(parsed));
    }
    assert.ok(seen.size >= 3, symbol);
  }
  assert.deepEqual(suggestReharmonizations('N.C.'), []);
  assert.deepEqual(suggestReharmonizations('not a chord'), []);
});

test('drafts are separate per song and survive navigation but reset when source changes', () => {
  const drafts = new ReharmonizationDrafts();
  const song = { id: 'one', rawContent: 'C  G\nWords here' };
  drafts.forSong(song).set(0, 'Cm9');
  assert.equal(drafts.forSong({...song}).get(0), 'Cm9');
  assert.equal(drafts.forSong({...song, id: 'two'}).size, 0);
  assert.equal(drafts.forSong({...song, title: 'Renamed'}).get(0), 'Cm9');
  assert.equal(drafts.forSong({...song, rawContent: 'G\nNew words'}).size, 0);
  assert.equal(song.rawContent, 'C  G\nWords here');
  assert.equal(drafts.forSong(null).size, 0);
});

test('reads a cross relation as a rub, and an ordinary semitone as ordinary', () => {
  // C to A major puts C sharp against the C you have just left. C to F puts F
  // against that same chord's E, which is the plainest voice leading there is,
  // so it must not be reported.
  assert.deepEqual(transition('C', 'A').crossRelations, [{ was: 'C', becomes: 'C#' }]);
  assert.deepEqual(transition('C', 'F').crossRelations, []);
  assert.deepEqual(transition('C', 'G7').crossRelations, []);
  assert.deepEqual(transition('C', 'F7').crossRelations, [{ was: 'E', becomes: 'Eb' }]);
  assert.equal(transition('C', 'not a chord'), null);
});

test('counts the notes a transition carries over', () => {
  assert.equal(transition('C', 'Am7').shared, 3);
  assert.deepEqual(transition('C', 'Am7').sharedNotes.sort(), ['C', 'E', 'G']);
  assert.equal(transition('C', 'F#').shared, 0);
});

test('warns on the neighbour a suggestion contradicts, and stays quiet otherwise', () => {
  const options = suggestReharmonizations('Am', { prevChord: 'C', nextChord: 'F' });
  const major = options.find(item => item.symbol === 'A');
  assert.match(major.transitionNote, /C# contradicts the C in C/);
  assert.equal(major.rubs, 2);
  // Adding a seventh to the minor chord contradicts nothing either side.
  assert.equal(options.find(item => item.symbol === 'Am7').rubs, 0);
  assert.equal(options.find(item => item.symbol === 'Am7').transitionNote, '');
});

test('says nothing about transitions when there are no neighbours', () => {
  for (const option of suggestReharmonizations('C')) {
    assert.equal(option.into, null);
    assert.equal(option.outOf, null);
    assert.equal(option.rubs, 0);
    assert.equal(option.transitionNote, '');
  }
});

test('orders gentler colours first, and a rub last inside its band', () => {
  const options = suggestReharmonizations('Am', { prevChord: 'C', nextChord: 'F' });
  const strengths = options.map(item => item.strength);
  assert.deepEqual(strengths, [...strengths].sort((a, b) => a - b), 'strength bands out of order');
  for (let at = 1; at < options.length; at += 1) {
    if (options[at].strength !== options[at - 1].strength) continue;
    assert.ok(options[at].rubs >= options[at - 1].rubs, `${options[at].symbol} rubs less than the row above it`);
  }
});

test('keeps the written order where nothing separates two suggestions', () => {
  // Without neighbours every tie-breaker is zero, so only the strength bands
  // move anything and the order inside each band is the one written down.
  const names = suggestReharmonizations('Am').filter(item => item.strength === 1).map(item => item.symbol);
  assert.deepEqual(names, ['Am7', 'Am9', 'Am11', 'Am6', 'Am13', 'Amadd9']);
});

test('offers a flat seventh only once the chord is known to be the tonic or the fourth', () => {
  const cMajor = inferKey(['C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C']);
  assert.ok(cMajor.confident);
  assert.ok(names('C', { key: cMajor }).includes('C7'), 'I7 in C major');
  assert.ok(names('F', { key: cMajor }).includes('F7'), 'IV7 in C major');
  // The fifth degree is already a dominant in the key, so nothing is added.
  assert.ok(!names('G', { key: cMajor }).includes('G7#5'));
  // Without a key, and with an unconfident one, neither appears.
  assert.ok(!names('C').includes('C7'));
  assert.ok(!names('C', { key: inferKey(['C', 'Am', 'C', 'Am']) }).includes('C7'));
});

test('labels each suggestion with its degree and whether it is in the key', () => {
  const cMajor = inferKey(['C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C']);
  const options = suggestReharmonizations('F', { key: cMajor });
  assert.equal(options.find(item => item.symbol === 'Fmaj7').numeral, 'IVmaj7');
  assert.equal(options.find(item => item.symbol === 'Fmaj7').diatonic, true);
  assert.equal(options.find(item => item.symbol === 'F7').numeral, 'IV7');
  assert.equal(options.find(item => item.symbol === 'F7').diatonic, false);
  // No key means no claim either way.
  const blind = suggestReharmonizations('F');
  assert.equal(blind[0].numeral, '');
  assert.equal(blind[0].diatonic, null);
});

test('a rub the original already has is not blamed on the suggestion', () => {
  // Bb is outside C major and rubs against the B in G7 whatever you do to it,
  // so extending it must not be reported as introducing the rub.
  const options = suggestReharmonizations('Bb', { prevChord: 'G7' });
  const extended = options.find(item => item.symbol === 'Bbmaj7');
  assert.ok(extended);
  assert.ok(!/contradicts/.test(extended.transitionNote), extended.transitionNote);
});

test('names the shape a chord sits in', () => {
  const cMajor = inferKey(['Dm7', 'G7', 'Cmaj7', 'Dm7', 'G7', 'Cmaj7']);
  const shape = context => describeProgression(context)?.label || null;
  assert.equal(shape({ prevChord: 'Dm7', symbol: 'G7', nextChord: 'Cmaj7', key: cMajor }), 'ii–V–I');
  assert.equal(shape({ prevChord: 'Dm7', symbol: 'G7', nextChord: 'Am', key: cMajor }), 'V–vi, the resolution withheld');
  assert.equal(shape({ prevChord: 'C', symbol: 'C', nextChord: 'F', key: cMajor }), 'the same chord again');
  assert.equal(shape({ prevChord: 'C', symbol: 'A7', nextChord: 'Dm7', key: cMajor }), 'dominant of Dm7');
  assert.equal(shape({ prevChord: 'C', symbol: 'F', nextChord: 'C', key: cMajor }), null);
  assert.equal(shape({ symbol: 'not a chord' }), null);
});

test('the ii-V-I shape needs a key, the dominant relationship does not', () => {
  // Degrees cannot be named without a key, but one chord being a fifth above
  // the next is true regardless.
  assert.equal(describeProgression({ prevChord: 'Dm7', symbol: 'G7', nextChord: 'Cmaj7' }).secondaryDominant, true);
  const unconfident = inferKey(['C', 'Am', 'C', 'Am']);
  assert.ok(!describeProgression({ prevChord: 'Dm7', symbol: 'G7', nextChord: 'Cmaj7', key: unconfident }).twoFiveOne);
});

test('the tritone substitute names its bass walk inside a ii-V-I', () => {
  const cMajor = inferKey(['Dm7', 'G7', 'Cmaj7', 'Dm7', 'G7', 'Cmaj7']);
  const inside = suggestReharmonizations('G7', { prevChord: 'Dm7', nextChord: 'Cmaj7', key: cMajor })
    .find(item => item.flavor === 'Tritone substitute');
  assert.match(inside.explanation, /bass walks D → Db → C/);
  // Outside one, there is no walk to describe.
  const alone = suggestReharmonizations('G7', { nextChord: 'Cmaj7', key: cMajor })
    .find(item => item.flavor === 'Tritone substitute');
  assert.ok(!/bass walks/.test(alone.explanation));
});

test('every suggestion carries the shape, so the panel can state it once', () => {
  const cMajor = inferKey(['Dm7', 'G7', 'Cmaj7', 'Dm7', 'G7', 'Cmaj7']);
  const options = suggestReharmonizations('G7', { prevChord: 'Dm7', nextChord: 'Cmaj7', key: cMajor });
  assert.ok(options.length > 0);
  for (const option of options) assert.equal(option.progression.label, 'ii–V–I');
  for (const option of suggestReharmonizations('G7')) assert.equal(option.progression, null);
});

/* ---------- suggestions drawn from the chord's function in the key ---------- */

test('substitutes the key\'s own chords a third either side', () => {
  const cMajor = inferKey(['C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C']);
  // The tonic's neighbours a third away are iii and vi, in the key's qualities.
  const tonic = names('C', { key: cMajor });
  assert.ok(tonic.includes('Em7'), 'iii7 above the tonic');
  assert.ok(tonic.includes('Am7'), 'vi7 below the tonic');
  // The fourth degree's are vi and ii, which the blind relative-third rule
  // could never have found: it only ever looked a fixed interval away.
  const fourth = names('F', { key: cMajor });
  assert.ok(fourth.includes('Am7'), 'iii7 above the fourth');
  assert.ok(fourth.includes('Dm7'), 'ii7 below the fourth');
  // Both stay inside the key, so both sit in the second band.
  const option = suggestReharmonizations('F', { key: cMajor }).find(item => item.symbol === 'Dm7');
  assert.equal(option.strength, 2);
  assert.equal(option.diatonic, true);
});

test('borrows the same degree from the parallel mode', () => {
  const cMajor = inferKey(['C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C']);
  // One rule, the whole borrowed vocabulary: i, iv, v, bVI on their degrees.
  for (const [chord, borrowed] of [['C', 'Cm'], ['F', 'Fm'], ['G', 'Gm'], ['Am', 'Ab'], ['Em', 'Eb']]) {
    assert.ok(names(chord, { key: cMajor }).includes(borrowed), `${borrowed} for ${chord}`);
  }
  const option = suggestReharmonizations('Am', { key: cMajor }).find(item => item.symbol === 'Ab');
  assert.equal(option.numeral, 'bVI');
  assert.equal(option.strength, 3, 'a borrowed chord reaches outside the key');
  assert.match(option.explanation, /sixth degree of C minor/);
});

test('a minor key only borrows back the two chords that are idiomatic', () => {
  const aMinor = inferKey(['Am', 'Dm', 'E7', 'Am', 'F', 'G', 'E7', 'Am']);
  assert.equal(aMinor.name, 'A minor');
  // The raised third of a Picardy close, and the raised sixth that makes the
  // fourth degree major.
  assert.ok(names('Am', { key: aMinor }).includes('A'), 'I borrowed on the tonic');
  assert.ok(names('Dm', { key: aMinor }).includes('D'), 'IV borrowed on the fourth');
  // Everything else would be offered only for the sake of symmetry.
  const sixth = suggestReharmonizations('F', { key: aMinor });
  assert.ok(!sixth.some(item => /^Borrowed/.test(item.flavor)), 'nothing borrowed onto bVI');
});

test('offers the chromatic ways into a chord the key can name', () => {
  const cMajor = inferKey(['Dm7', 'G7', 'Cmaj7', 'Dm7', 'G7', 'Cmaj7']);
  // A flattened seventh leaning up into the tonic, offered only where the
  // tonic is the chord that follows.
  assert.ok(names('G7', { nextChord: 'Cmaj7', key: cMajor }).includes('Bb7'));
  assert.ok(!names('G7', { nextChord: 'Am', key: cMajor }).includes('Bb7'));
  // The Neapolitan stands in for the chords that set up the dominant.
  assert.ok(names('Dm7', { key: cMajor }).includes('Db'), 'bII on the second degree');
  assert.ok(names('F', { key: cMajor }).includes('Db'), 'bII on the fourth degree');
  assert.ok(!names('C', { key: cMajor }).includes('Db'), 'not on the tonic');
});

test('any chord can slide into the next one, not only a dominant', () => {
  // The tritone substitute taken from the other side, so a plain triad gets one.
  const options = suggestReharmonizations('C', { nextChord: 'F' });
  const slide = options.find(item => item.flavor === 'Slide into F');
  assert.equal(slide.symbol, 'Gb7');
  assert.equal(slide.strength, 4);
  // A dominant already offers one from its own root, so it is not offered twice.
  assert.ok(!suggestReharmonizations('G7', { nextChord: 'C' }).some(item => /^Slide/.test(item.flavor)));
});

/* ---------- how far a suggestion reaches ---------- */

test('measures reach against the key, not against the chord alone', () => {
  const cMajor = inferKey(['C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C']);
  const band = (chord, name) =>
    suggestReharmonizations(chord, { key: cMajor }).find(item => item.symbol === name).strength;
  // The same raised eleventh: chromatic over the tonic, plain lydian colour
  // over the fourth degree, where every note of it is already in the key.
  assert.equal(band('C', 'Cmaj9#11'), 3);
  assert.equal(band('F', 'Fmaj9#11'), 1);
  // A diatonic substitution is a smaller step than a borrowed chord, however
  // far its root moves. The old measure had this the other way round.
  assert.ok(band('C', 'Am7') < band('C', 'Cm'));
  // Changing what the progression does outranks any reading of the notes.
  assert.equal(suggestReharmonizations('G7', { nextChord: 'C', key: cMajor })
    .find(item => item.symbol === 'Db7').strength, 4);
});

test('a chord already outside the key is not charged for staying there', () => {
  const cMajor = inferKey(['C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C']);
  // Eb is bIII, so its own Eb and Bb are outside C major whatever is done to
  // it. Extending it is still only extending it; taking its third down is not.
  const options = suggestReharmonizations('Eb', { key: cMajor });
  assert.equal(options.find(item => item.symbol === 'Ebmaj7').strength, 1);
  assert.equal(options.find(item => item.symbol === 'Ebm').strength, 3);
  // The flat fact about the chord is still reported as it stands.
  assert.equal(options.find(item => item.symbol === 'Ebmaj7').diatonic, false);
});

test('without a key the bands fall back to the role alone', () => {
  const options = suggestReharmonizations('C');
  const band = name => options.find(item => item.symbol === name).strength;
  assert.equal(band('Cmaj7'), 1, 'adds notes only');
  assert.equal(band('Cmaj9#11'), 2, 'an altered tension, with nothing to judge it against');
  assert.equal(band('Cm'), 2, 'a changed quality on the same root');
  assert.equal(band('Am7'), 3, 'a moved root');
  for (const option of options) assert.equal(option.diatonic, null);
  assert.match(options.find(item => item.symbol === 'Cm').strengthNote, /same root/);
});

test('every suggestion carries words for its band, since the tint cannot speak', () => {
  const cMajor = inferKey(['C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C']);
  for (const option of suggestReharmonizations('C', { nextChord: 'Am', key: cMajor })) {
    assert.ok(option.strengthNote, option.symbol);
    assert.ok(option.strength >= 1 && option.strength <= 4, option.symbol);
  }
});

/* ---------- suggestions drawn from the shape the chord sits in ---------- */

const cMajor = () => inferKey(['Dm7', 'G7', 'Cmaj7', 'Dm7', 'G7', 'Cmaj7']);

test('a repeated chord is offered movement rather than more colour', () => {
  const key = cMajor();
  const options = suggestReharmonizations('C', { prevChord: 'C', nextChord: 'F', key });
  const names = options.map(item => item.symbol);
  // The cheapest movement under a chord that does not change is its own bass.
  assert.ok(names.includes('C/E'), 'over its third');
  assert.ok(names.includes('C/G'), 'over its fifth');
  // Both keep every note, so both sit in the gentlest band.
  assert.equal(options.find(item => item.symbol === 'C/E').strength, 1);
  // And the inner line that walks while the root holds, named as what it is.
  const cliche = options.find(item => item.flavor === 'Line cliché');
  assert.equal(cliche.symbol, 'Cmaj7');
  assert.match(cliche.explanation, /C → Cmaj7 → C7/);
  // None of it is offered where the chord is not repeated.
  const once = suggestReharmonizations('C', { prevChord: 'G', nextChord: 'F', key }).map(item => item.symbol);
  assert.ok(!once.includes('C/E'));
  assert.ok(!once.includes('C/G'));
});

test('a chord already over a bass note is not given a second one', () => {
  // The decision has been made for it, and stacking a slash on a slash would
  // not say anything.
  const options = suggestReharmonizations('C/E', { prevChord: 'C/E', nextChord: 'F', key: cMajor() });
  for (const option of options) assert.ok(option.symbol.split('/').length <= 2, option.symbol);
});

test('the shapes that lean on the next chord are offered the diminished under it', () => {
  const key = cMajor();
  const lean = (context) => suggestReharmonizations(context.symbol, context)
    .find(item => /^Lean into/.test(item.flavor));
  // Inside a ii-V-I, the dominant without its root.
  const inTwoFive = lean({ symbol: 'G7', prevChord: 'Dm7', nextChord: 'Cmaj7', key });
  assert.equal(inTwoFive.symbol, 'Bdim7');
  assert.equal(inTwoFive.strength, 4);
  // On a deceptive cadence, leaning into the sixth degree it sidesteps to.
  assert.equal(lean({ symbol: 'G7', prevChord: 'C', nextChord: 'Am', key }).symbol, 'G#dim7');
  // On a repeated chord, leaning out of the bar instead of sitting in it.
  assert.equal(lean({ symbol: 'C', prevChord: 'C', nextChord: 'F', key }).symbol, 'Edim7');
  // Nothing to lean into where the chord makes no shape at all.
  assert.equal(lean({ symbol: 'F', prevChord: 'C', nextChord: 'G', key }), undefined);
});

test('a dominant of the next chord can be stepped through instead of arrived on', () => {
  const key = cMajor();
  const delay = suggestReharmonizations('A7', { prevChord: 'C', nextChord: 'Dm7', key })
    .find(item => /^Delay/.test(item.flavor));
  // Only one chord fits where one chord was, so this is the second degree of
  // the target standing where its dominant stood. A minor target takes the
  // half-diminished second, which is the minor two-five.
  assert.equal(delay.symbol, 'Em7b5');
  const major = suggestReharmonizations('G7', { prevChord: 'Am', nextChord: 'C', key })
    .find(item => /^Delay/.test(item.flavor));
  assert.equal(major.symbol, 'Dm7');
});

test('a diminished seventh is offered the root it was standing in for', () => {
  // Bdim7 is G7b9 without its root, so putting the root back states outright
  // what the chord was already doing.
  const option = suggestReharmonizations('Bdim7').find(item => item.flavor === 'Give it a root');
  assert.equal(option.symbol, 'G7b9');
  assert.equal(option.strength, 4);
});

test('fills the gaps the quality table used to leave', () => {
  const has = (chord, name) => names(chord).includes(name);
  for (const [chord, name] of [
    ['C', 'C6'], ['C', 'Cmaj13'], ['C', 'Csus2'],
    ['Am', 'Am13'], ['Am', 'Amadd9'],
    ['G7', 'G7alt'],
    ['E5', 'E7']
  ]) assert.ok(has(chord, name), `${name} for ${chord}`);
});

test('names each band in a word or two for the filter chips', () => {
  // The middle two bands mean something different once there is a key to
  // measure against, and the chips have to say which.
  assert.equal(reachChip(2, true), 'In key');
  assert.equal(reachChip(2, false), 'Same root');
  assert.equal(reachChip(3, true), 'Outside');
  assert.equal(reachChip(3, false), 'New root');
  // The outer two mean the same thing either way.
  for (const keyed of [true, false]) {
    assert.equal(reachChip(1, keyed), 'Colour');
    assert.equal(reachChip(4, keyed), 'Redirect');
  }
  assert.equal(reachChip(9, true), '');
});
