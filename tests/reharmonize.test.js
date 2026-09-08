import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestReharmonizations, ReharmonizationDrafts } from '../public/reharmonize.js';
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
