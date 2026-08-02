/* Chord lookup panel.

   A standalone window for looking up any chord and seeing every voicing the
   generator found for it, whether or not a song is open. Every shape is laid
   out at once rather than stepped through, which makes it easy to see what the
   generator does and does not cover. */

import { getVoicings, parseChordSymbol } from "./chord-voicings.js";
import { createChordDiagram, positionLabel } from "./chord-diagram.js";
import { isChordToken, isPlainChordLine, transposeChord } from "./chord-utils.js";
import { removeUgTags, stripTabTags } from "./song-model.js";

const MAX_CHIPS = 24;

let elements = null;
let getSongChords = () => [];
let query = "";
let inversions = false;
let debounce = 0;

export function initChordExplorer(options = {}) {
  const dialog = document.querySelector("#chordDialog");
  const openButton = document.querySelector("#chordLookupButton");
  if (!dialog || !openButton) return;

  getSongChords = options.getSongChords || getSongChords;

  elements = {
    dialog,
    form: dialog.querySelector("#chordExplorerForm"),
    input: dialog.querySelector("#chordExplorerInput"),
    chips: dialog.querySelector("#chordExplorerChips"),
    inversions: dialog.querySelector("#chordExplorerInversions"),
    summary: dialog.querySelector("#chordExplorerSummary"),
    results: dialog.querySelector("#chordExplorerResults"),
    close: dialog.querySelector("#closeChordDialogButton")
  };

  openButton.addEventListener("click", open);
  elements.close.addEventListener("click", () => dialog.close());

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    show(elements.input.value);
  });

  elements.input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => show(elements.input.value), 160);
  });

  elements.inversions.addEventListener("change", () => {
    inversions = elements.inversions.checked;
    show(elements.input.value);
  });

  elements.chips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-chord]");
    if (!chip) return;
    elements.input.value = chip.dataset.chord;
    show(chip.dataset.chord);
    elements.input.focus();
  });
}

function open() {
  renderChips();
  elements.input.value = query;
  elements.inversions.checked = inversions;
  elements.dialog.showModal();
  elements.input.focus();
  elements.input.select();
  show(query);
}

function renderChips() {
  const chords = getSongChords().slice(0, MAX_CHIPS);
  elements.chips.replaceChildren();
  elements.chips.hidden = !chords.length;
  if (!chords.length) return;

  const label = document.createElement("span");
  label.className = "chord-explorer-chips-label";
  label.textContent = "In this song";
  elements.chips.append(label);

  for (const chord of chords) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chord-explorer-chip";
    chip.dataset.chord = chord;
    chip.textContent = chord;
    elements.chips.append(chip);
  }
}

function show(value) {
  query = value;
  const trimmed = value.trim();
  elements.results.replaceChildren();

  if (!trimmed) {
    elements.summary.textContent = "Type a chord to see how to play it.";
    elements.summary.classList.remove("is-warning");
    return;
  }

  const parsed = parseChordSymbol(trimmed);
  if (!parsed) {
    elements.summary.textContent = `"${trimmed}" is not a chord symbol I can read. Try things like Am7, C/G, F#m11, Bb13 or G7b9.`;
    elements.summary.classList.add("is-warning");
    return;
  }

  const voicings = getVoicings(parsed.symbol, { inversions });
  elements.summary.classList.toggle("is-warning", voicings.length === 0);

  if (!voicings.length) {
    elements.summary.textContent = `${parsed.root} ${parsed.qualityName} (${parsed.notes.join(" ")}) has no shape that is playable in standard tuning.`;
    return;
  }

  const rootShapes = voicings.filter((voicing) => !voicing.inversion).length;
  const inverted = voicings.length - rootShapes;
  const counts = inverted
    ? `${countShapes(rootShapes)} in root position, ${inverted} inverted`
    : countShapes(rootShapes);
  elements.summary.textContent = `${parsed.root} ${parsed.qualityName} · ${parsed.notes.join(" ")} · ${counts}`;

  for (const voicing of voicings) {
    elements.results.append(renderCard(voicing));
  }
}

function countShapes(total) {
  return total === 1 ? "1 shape" : `${total} shapes`;
}

function renderCard(voicing) {
  const card = document.createElement("figure");
  card.className = "chord-explorer-card";
  if (voicing.inversion) card.classList.add("is-inversion");
  card.append(createChordDiagram(voicing));

  const caption = document.createElement("figcaption");

  if (voicing.inversion) {
    const name = document.createElement("span");
    name.className = "chord-explorer-card-name";
    name.textContent = voicing.slashName;
    caption.append(name);
  }

  const position = document.createElement("span");
  position.className = "chord-explorer-card-position";
  position.textContent = positionLabel(voicing);

  const frets = document.createElement("span");
  frets.className = "chord-explorer-card-frets";
  frets.textContent = voicing.frets.map((fret) => (fret === null ? "x" : fret)).join(" ");

  caption.append(position, frets);
  card.append(caption);
  return card;
}

/* The chords a song actually uses, in the order they first appear, already
   transposed so they match what is on screen. */
export function collectSongChords(song, transpose = 0) {
  if (!song) return [];

  const seen = new Set();
  const chords = [];

  const add = (token) => {
    const chord = transposeChord(token, transpose)
      .replace(/^[([{]+/, "")
      .replace(/[)\]}]+$/, "")
      .replace(/[.,;:]+$/, "");
    if (!chord || seen.has(chord)) return;
    if (!parseChordSymbol(chord)) return;
    seen.add(chord);
    chords.push(chord);
  };

  const content = stripTabTags(song.rawContent || "");

  for (const match of content.matchAll(/\[ch\]([\s\S]*?)\[\/ch\]/gi)) {
    add(match[1].trim());
  }

  for (const line of content.split("\n")) {
    const cleaned = removeUgTags(line);
    if (!isPlainChordLine(cleaned)) continue;
    for (const token of cleaned.trim().split(/\s+/)) {
      if (isChordToken(token)) add(token);
    }
  }

  return chords;
}
