import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSheet, renderedSheetText } from '../public/song-renderer.js';

// The renderer uses only tree construction, text and class queries, so a small
// DOM double can test its output without a browser or a runtime dependency.
class Element {
  constructor() { this.childNodes = []; this.dataset = {}; this.className = ''; }
  classList = {
    contains: value => this.className.split(' ').includes(value),
    add: value => this.classList.toggle(value, true),
    toggle: (value, enabled) => {
      const values = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) values.add(value); else values.delete(value);
      this.className = [...values].join(' ');
    }
  };
  append(...children) { this.childNodes.push(...children); }
  get children() { return this.childNodes.filter(child => child instanceof Element); }
  get textContent() { return this.childNodes.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this.childNodes = [value]; }
  setAttribute(name, value) { this[name] = value; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.classList.contains(selector.slice(1)) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
globalThis.document = { createElement: () => new Element(), createDocumentFragment: () => new Element() };
const song = rawContent => ({id: 'song', rawContent});
const tokens = tree => tree.querySelectorAll('.chord-token');

test('an override affects one occurrence, identically in desktop and mobile copies', () => {
  const sheet = song('C     G     C\nFirst next  last');
  const rendered = renderSheet(sheet, 2, new Map([[0, 'Cm9']]));
  assert.deepEqual(tokens(rendered).map(token => token.textContent), ['Dm9', 'A', 'D', 'Dm9', 'A', 'D']);
  assert.deepEqual(tokens(rendered).map(token => token.dataset.chordId), ['0', '1', '2', '0', '1', '2']);
  assert.equal(tokens(rendered)[0].dataset.originalChord, 'D');
  assert.equal(tokens(renderSheet(sheet, 0))[0].textContent, 'C');
  assert.equal(sheet.rawContent, 'C     G     C\nFirst next  last');
});

test('occurrence IDs cover tagged chords and chord-only lines without counting responsive copies', () => {
  const tree = renderSheet(song('[Verse]\n[ch]Am[/ch]One [ch]G[/ch]two\n\nC  F\n[Outro]\n[ch]C[/ch][ch]G[/ch]'), 0);
  assert.deepEqual(tokens(tree).map(token => token.dataset.chordId), ['0','1','0','1','2','3','4','5']);
  assert.deepEqual(tree.querySelectorAll('.section-label').map(row => row.textContent), ['Verse','Outro']);
});

test('saved arrangements preserve sections, repeat markings, grouping and each lyric once', () => {
  const sheet = song('[Verse]\nC  | (G  Am) x2\nOne   two   three');
  const text = renderedSheetText(sheet, 0, new Map([[1, 'G13#11']]));
  assert.match(text, /^\[Verse\]\nC\s+\|\s+\(G13#11\s+Am\)\s+x2/);
  for (const word of ['One','two','three']) assert.equal(text.split(word).length - 1, 1);
  const reread = tokens(renderSheet(song(text), 0));
  assert.deepEqual(reread.slice(0,3).map(token => token.textContent), ['C','(G13#11','Am)']);
});

test('a long replacement leaves the following chord over its lyric on export', () => {
  const text = renderedSheetText(song('C  G\nHi you'), 0, new Map([[0, 'Cmaj9#11']]));
  const [chords, lyrics] = text.split('\n');
  assert.equal(chords.indexOf('G'), lyrics.indexOf('you'));
  assert.equal(chords, 'Cmaj9#11 G');
});

test('grouping survives changes without copying alteration parentheses', () => {
  const tree = renderSheet(song('(C)  G7(b9)  Am)\nOne  two     three'), 0, new Map([[0,'Cm'],[1,'G13'],[2,'Amaj9']]));
  assert.deepEqual(tokens(tree).slice(0,3).map(token => token.textContent), ['(Cm)','G13','Amaj9)']);
});
