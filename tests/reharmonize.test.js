import assert from 'node:assert/strict';
import test from 'node:test';
import { describeProgression, suggestReharmonizations, transition, ReharmonizationDrafts } from '../public/reharmonize.js';
import { inferKey } from '../public/song-key.js';
import { parseChordSymbol } from '../public/chord-voicings.js';

const names = (chord, context) => suggestReharmonizations(chord, context).map(item => item.symbol);

test('offers parallel major/minor changes and rich extensions', () => {
  for (const name of ['Cm', 'Cm9', 'Cmaj9', 'Cmaj9#11', 'Am7']) assert.ok(names('C').includes(name), name);
  for (const name of ['A', 'Amaj9', 'Am11', 'Ammaj7', 'Cmaj7']) assert.ok(names('Am').includes(name), name);
  assert.equal(suggestReharmonizations('C').find(item => item.symbol === 'Cm').bold, true);
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
  assert.deepEqual(names, ['Am7', 'Am9', 'Am11', 'Am6']);
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
