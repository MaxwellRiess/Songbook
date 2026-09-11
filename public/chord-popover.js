/* The harmony panel, and the hover preview that precedes it.

   Clicking a chord opens a panel that stays open until it is dismissed. On a
   wide pointer device it docks as a column down the right of the window, so the
   sheet reflows beside it and nothing overlaps: you can scroll the song and
   click through its chords with the panel holding still. On a narrow screen or
   a touch screen it is a bottom sheet instead, which is already clear of the
   lyrics.

   Docking replaced an earlier floating window that could be dragged clear of
   the sheet. A column that cannot overlap is what the dragging was reaching
   for, and it also frees the panel from having to fit inside a viewport-height
   box, so the reharmonize options and the approaches have room.

   Hovering a chord previews its shape in a small window, and clicking one keeps
   that window up so the voicings can be stepped through without the panel in
   the way. The window carries a small Re-harmonize button, and that is the only
   thing that opens the panel: looking up a shape and reaching for harmony are
   different jobs, and the smaller one should not drag the larger one open.

   Previews are suppressed while the panel is open, where moving the mouse would
   otherwise keep pulling the panel off the chord being worked on. */

import { getVoicings, parseChordSymbol } from "./chord-voicings.js";
import { createChordDiagram, positionLabel } from "./chord-diagram.js";
import { describeProgression, reachChip, suggestReharmonizations } from "./reharmonize.js";
import { romanNumeral } from "./song-key.js";
import { playChordSequence, playChordVoicing, stopChordAudio } from "./chord-audio.js";
import { suggestApproaches } from "./approach.js";

const SHOW_DELAY = 110;
const HIDE_DELAY = 240;
const CACHE = new Map();
const CHOSEN = new Map(); // remembers the voicing picked for each chord this session

let ui = null;
let anchor = null;
let symbol = null;
let voicings = [];
let index = 0;
/* "floating" is the small chord window. "docked" and "sheet" are the two
   presentations of the panel, chosen by how much room there is. A floating
   window is transient while it is only being hovered, and sticky once it has
   been clicked, which is what lets the voicings be stepped through. */
let mode = "floating";
let sticky = false;
let showTimer = 0;
let hideTimer = 0;
let callbacks = {};
let reharmonizing = false;
let selectedAlternative = null;
let sheetRoot = null;
/* The panel opens showing its suggestions, so this is the user saying they
   want the shapes on their own for a while. It outlives the chord being looked
   at, because collapsing it once and having it spring back on the next chord
   would not be a preference at all. */
let collapsed = false;
/* Which bands the list is showing, or null for all of them. Also kept across
   chords: narrowing to the bold end is a way of reading the whole song, not a
   decision about one chord. */
let bands = null;
/* The neighbours of the chord being worked on, so the audio row can play the
   bar as it stands without asking for them again, and the song's key, which
   the head line needs to name a degree whether or not the panel is open. */
let neighbours = { prevChord: "", nextChord: "" };
let songKey = null;

const DOCK_WIDTH = 1000; // below this there is no room for a column beside the sheet

function persistentMode() {
  const pointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  return pointer && window.innerWidth >= DOCK_WIDTH ? "docked" : "sheet";
}

const isOpenPanel = () => mode !== "floating" && ui && !ui.root.hidden;
/* Anything the reader has committed to by clicking. Hovering elsewhere must not
   pull it away from the chord being looked at. */
const isHeld = () => Boolean(ui) && !ui.root.hidden && (mode !== "floating" || sticky);

export function initChordPopover(root, options = {}) {
  if (!root) return;
  callbacks = options;
  sheetRoot = root;

  root.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    // A preview that follows the mouse would keep pulling an open panel, or a
    // window that was clicked open, off the chord being looked at.
    if (isHeld()) return;
    const token = event.target.closest?.(".chord-token");
    if (!token || token === anchor) return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => open(token, { mode: "floating" }), SHOW_DELAY);
  });

  root.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse" || isHeld()) return;
    if (!event.target.closest?.(".chord-token")) return;
    clearTimeout(showTimer);
    scheduleHide();
  });

  root.addEventListener("click", (event) => {
    const token = event.target.closest?.(".chord-token");
    if (!token) return;
    event.preventDefault();
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (isHeld() && token === anchor) close();
    // Clicking a chord holds the small window open. The panel is only opened
    // from the button inside it, or by clicking another chord once it is open.
    else if (isOpenPanel()) open(token, { mode });
    else open(token, { mode: "floating", sticky: true });
  });

  root.addEventListener("keydown", event => {
    const token = event.target.closest?.(".chord-token");
    if (token && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (isOpenPanel()) open(token, { mode });
      else open(token, { mode: "floating", sticky: true });
      // Focus lands on the way into the panel, so a keyboard reaches it too.
      ui.root.querySelector(".reharm-toggle").focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!ui || ui.root.hidden) return;
    if (ui.root.contains(event.target)) return;
    if (event.target.closest?.(".chord-token")) return;
    // The panel is dismissed deliberately, not by clicking past it. Only the
    // transient preview goes away on its own.
    if (mode === "floating") close();
  });

  document.addEventListener("keydown", (event) => {
    if (!ui || ui.root.hidden) return;
    if (event.key === "Escape") {
      const returnFocus = ui.root.contains(document.activeElement);
      const previous = anchor;
      close();
      if (returnFocus) previous?.focus();
    } else if (event.key === "ArrowRight" && (ui.root.contains(event.target) || event.target === anchor)) {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft" && (ui.root.contains(event.target) || event.target === anchor)) {
      event.preventDefault();
      step(-1);
    }
  });

  root.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", () => {
    if (!ui || ui.root.hidden) return;
    if (mode === "floating") {
      close();
      return;
    }
    // A window narrowing past the dock width turns the column into a sheet.
    applyMode(persistentMode());
    reposition();
  });
}

export function closeChordPopover() {
  close();
}

/* Opening the panel from outside the sheet, where there is no chord under the
   pointer to open it on. It picks up where it was left: the chord it was last
   pointed at if that chord is still in the rendered sheet, and otherwise the
   first one in the song.

   Reaching for this is asking for harmony, so it opens on the suggestions even
   if they were last stood down. The small Hide inside the panel is what that
   preference is for, and honouring it here would answer the button with a
   panel showing none of what was asked for. */
export function toggleHarmonyPanel() {
  if (isOpenPanel()) {
    close();
    return false;
  }
  const token = firstChordToken();
  if (!token) return false;
  collapsed = false;
  open(token, { mode: persistentMode(), sticky: true, keepPanel: true });
  return true;
}

export function harmonyPanelOpen() {
  return isOpenPanel();
}

/* The sheet draws each chord twice, once for the column layout and once for the
   flowed one, and only the layout in use is laid out at all. A panel anchored
   to the hidden twin would mark a chord nobody can see, so the first one with a
   box is the one to take. */
function firstChordToken() {
  if (anchor?.isConnected) return anchor;
  if (!sheetRoot) return null;
  const tokens = [...sheetRoot.querySelectorAll(".chord-token[data-chord-id]")];
  return tokens.find(token => token.offsetParent !== null) || tokens[0] || null;
}

/* Re-rendering the sheet replaces every chord token, so a panel pointing at one
   loses its anchor. Applying a chord is part of working through a song with the
   panel open, so the caller captures what the panel is showing, re-renders, and
   puts it back. Switching songs does not, which is why this is the caller's
   decision rather than something done automatically. */
export function chordPanelState() {
  if (!ui || ui.root.hidden || mode === "floating" || !anchor) return null;
  return { chordId: anchor.dataset.chordId, mode, reharmonizing };
}

export function restoreChordPanel(state) {
  if (!state || !sheetRoot || state.chordId === undefined) return;
  const token = sheetRoot.querySelector(`[data-chord-id="${state.chordId}"]`);
  if (!token) return;
  open(token, { mode: state.mode, keepPanel: state.reharmonizing });
}

function ensureUi() {
  if (ui) return ui;

  const root = document.createElement("div");
  root.className = "chord-popover";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Chord shapes and reharmonization");

  root.innerHTML = `
    <div class="chord-popover-head">
      <div class="chord-popover-titles">
        <strong class="chord-popover-name"></strong>
        <span class="chord-popover-quality"></span>
      </div>
      <button type="button" class="chord-popover-close" aria-label="Close the harmony panel">&times;</button>
    </div>
    <div class="chord-popover-body">
      <button type="button" class="chord-popover-nav" data-step="-1" aria-label="Previous voicing">&#8249;</button>
      <div class="chord-popover-stage"></div>
      <button type="button" class="chord-popover-nav" data-step="1" aria-label="Next voicing">&#8250;</button>
    </div>
    <div class="chord-popover-foot">
      <span class="chord-popover-position"></span>
      <span class="chord-popover-count"></span>
    </div>
    <button type="button" class="reharm-toggle" aria-pressed="false" aria-expanded="false" aria-controls="reharmPanel">Re-harmonize</button>
    <section id="reharmPanel" class="reharm-panel" hidden>
      <div class="reharm-bar">
        <p class="reharm-context"></p>
        <button type="button" class="reharm-collapse" aria-expanded="true" aria-controls="reharmBody">Hide</button>
      </div>
      <div id="reharmBody" class="reharm-body">
        <div class="reharm-filters" role="group" aria-label="Show only suggestions that reach this far"></div>
        <div class="reharm-options" role="group" aria-label="Alternative chords"></div>
        <div class="reharm-detail" aria-live="polite"></div>
        <div class="reharm-audio" role="group" aria-label="Hear the chord where it sits">
          <div class="reharm-audio-col">
            <button type="button" class="reharm-hear-prev"></button>
            <span class="reharm-audio-label">previous</span>
          </div>
          <div class="reharm-audio-col is-middle">
            <button type="button" class="reharm-hear-original"></button>
            <button type="button" class="reharm-hear"></button>
            <span class="reharm-audio-label">current</span>
          </div>
          <div class="reharm-audio-col">
            <button type="button" class="reharm-hear-next"></button>
            <span class="reharm-audio-label">next</span>
          </div>
        </div>
        <p class="reharm-audio-note">Synthesized standard-tuning voicing, without capo.</p>
      <button type="button" class="reharm-apply" disabled>Use this chord</button>
      <button type="button" class="reharm-reset" hidden>Restore original chord</button>
      <details class="approach-panel">
        <summary>Leads into this chord</summary>
        <p class="approach-note">Ideas for what could come before. Nothing is added to the sheet.</p>
        <div class="approach-options" role="group" aria-label="Approach chords"></div>
        <p class="approach-detail" aria-live="polite"></p>
      </details>
        <p class="reharm-session">Changes are a draft. Copy or save a new version to keep them.</p>
        <p class="reharm-status" role="status"></p>
      </div>
    </section>
  `;

  // Inside the shell, so the docked column can be one of its grid tracks.
  (document.querySelector("#appShell") || document.body).append(root);

  ui = {
    root,
    head: root.querySelector(".chord-popover-head"),
    name: root.querySelector(".chord-popover-name"),
    quality: root.querySelector(".chord-popover-quality"),
    stage: root.querySelector(".chord-popover-stage"),
    position: root.querySelector(".chord-popover-position"),
    count: root.querySelector(".chord-popover-count"),
    prev: root.querySelector('[data-step="-1"]'),
    next: root.querySelector('[data-step="1"]')
  };

  root.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") clearTimeout(hideTimer);
  });
  root.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && mode === "floating") scheduleHide();
  });
  root.querySelector(".chord-popover-close").addEventListener("click", () => {
    const previous = anchor;
    close();
    previous?.focus({ preventScroll: true });
  });
  ui.prev.addEventListener("click", () => step(-1));
  ui.next.addEventListener("click", () => step(1));
  /* Only the small window carries this, where it is the way into the panel
     rather than a toggle. Inside the panel the suggestions are the point, and
     the small collapse below is what stands them down. */
  root.querySelector(".reharm-toggle").addEventListener("click", () => {
    clearTimeout(hideTimer);
    applyMode(persistentMode());
    collapsed = false;
    reharmonizing = true;
    renderReharmonization();
    reposition();
    /* The window was already up, so this widens it into the panel rather than
       opening anything, and is the one way in that does not pass through
       `open`. It still has to say so. */
    announcePanel();
  });
  root.querySelector(".reharm-collapse").addEventListener("click", () => {
    collapsed = !collapsed;
    reharmonizing = !collapsed;
    renderReharmonization();
    reposition();
  });
  root.querySelector(".reharm-hear-prev").addEventListener("click", () =>
    hear(neighbours.prevChord, lookup(neighbours.prevChord)[0]));
  root.querySelector(".reharm-hear-next").addEventListener("click", () =>
    hear(neighbours.nextChord, lookup(neighbours.nextChord)[0]));
  root.querySelector(".reharm-hear").addEventListener("click", () => hear(symbol, voicings[index]));
  root.querySelector(".reharm-hear-original").addEventListener("click", () => {
    const original = anchor.dataset.originalChord || anchor.dataset.chord;
    hear(original, lookup(original)[0]);
  });
  root.querySelector(".reharm-apply").addEventListener("click", () => {
    if (!selectedAlternative || !anchor || !callbacks.onReplace) return;
    const token = anchor, replacement = selectedAlternative.symbol;
    callbacks.onReplace(token, replacement);
  });
  root.querySelector(".reharm-reset").addEventListener("click", () => {
    if (anchor && callbacks.onReplace) callbacks.onReplace(anchor, null);
  });

  return ui;
}

function open(token, { mode: wanted, sticky: hold = false, keepPanel: forcePanel }) {
  stopChordAudio();
  const next = token.dataset.chord || token.textContent.trim();
  const parsed = parseChordSymbol(next);

  ensureUi();
  /* The panel is the reharmonize view: opening it on any chord shows the
     suggestions, and only an explicit collapse holds them back. A hover
     preview never shows them at all, since it is a different job. */
  const keepPanel = forcePanel === undefined
    ? wanted !== "floating" && !collapsed
    : forcePanel;
  anchor?.classList.remove("chord-token-active");
  anchor = token;
  reharmonizing = keepPanel;
  selectedAlternative = null;
  symbol = parsed ? parsed.symbol : next;
  voicings = parsed ? lookup(symbol) : [];
  index = Math.min(CHOSEN.get(symbol) || 0, Math.max(voicings.length - 1, 0));

  songKey = callbacks.getContext?.(token)?.key || null;
  ui.name.textContent = symbol;
  ui.quality.textContent = headDetail(parsed);
  sticky = hold;
  applyMode(wanted);
  ui.root.hidden = false;
  token.classList.add("chord-token-active");

  render();
  /* The small window shows a shape and a way in, so none of the panel's own
     work is done for it. */
  if (mode === "floating") {
    ui.root.querySelector(".reharm-panel").hidden = true;
  } else {
    renderReharmonization();
  }
  reposition();
  announcePanel();
}

/* The panel can be opened and closed from the sheet, from its own close button
   and from the song header, so whatever is showing its state elsewhere is told
   rather than left to guess. */
function announcePanel() {
  callbacks.onPanelChange?.(isOpenPanel());
}

/* What the chord is, and where it sits. The degree is the part worth having in
   the small hover window too: reading a numeral against a chord name, over and
   over, is how the relationship between the two stops needing to be worked
   out. It is only stated where the key was inferred confidently, since a
   numeral stated plainly and wrongly is worse than none. */
function headDetail(parsed) {
  if (!parsed) return "unrecognised chord";
  const numeral = songKey?.confident ? romanNumeral(parsed.symbol, songKey) : "";
  return [
    `${parsed.qualityName} \u00b7 ${parsed.notes.join(" ")}`,
    numeral && `${numeral} in ${songKey.name}`
  ].filter(Boolean).join(" \u00b7 ");
}

function lookup(name) {
  if (!CACHE.has(name)) CACHE.set(name, getVoicings(name));
  return CACHE.get(name);
}

function render() {
  if (!ui) return;

  ui.stage.replaceChildren();

  if (!voicings.length) {
    const message = document.createElement("p");
    message.className = "chord-popover-empty";
    message.textContent = "No playable shape found.";
    ui.stage.append(message);
    ui.position.textContent = "";
    ui.count.textContent = "";
    ui.prev.disabled = true;
    ui.next.disabled = true;
    return;
  }

  const voicing = voicings[index];
  ui.stage.append(createChordDiagram(voicing));
  ui.position.textContent = positionLabel(voicing);
  ui.count.textContent = `${index + 1} / ${voicings.length}`;
  ui.prev.disabled = index === 0;
  ui.next.disabled = index === voicings.length - 1;
}

function step(direction) {
  if (!voicings.length) return;
  const next = index + direction;
  if (next < 0 || next >= voicings.length) return;
  index = next;
  CHOSEN.set(symbol, index);
  // Stepping shapes is what the small window is for, so it holds rather than
  // escalating into the panel.
  sticky = true;
  clearTimeout(hideTimer);
  render();
  reposition();
}

function scheduleHide() {
  if (mode !== "floating" || sticky) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(close, HIDE_DELAY);
}

/* The docked column is a track of the app shell's grid, so the shell has to
   know when to make room for it. */
function applyMode(wanted) {
  mode = wanted;
  if (!ui) return;
  ui.root.classList.toggle("is-sheet", mode === "sheet");
  ui.root.classList.toggle("is-docked", mode === "docked");
  ui.root.classList.toggle("is-floating", mode === "floating");
  /* The suggestions belong to the panel, so the class that widens the window
     for them has to come off on the way back to a small one. */
  if (mode === "floating") ui.root.classList.remove("is-reharmonizing");
  /* The way into the panel belongs to the small window and to nothing else.
     Deciding that here rather than while drawing the panel matters: the panel
     only draws itself in its own modes, so a decision made there can only ever
     hide this button, never bring it back, and the small window would lose it
     for the rest of the session after the panel had been opened once. */
  ui.root.querySelector(".reharm-toggle").hidden = mode !== "floating";
  ui.root.setAttribute("aria-label", mode === "floating" ? "Chord shape" : "Harmony panel");
  document.querySelector("#appShell")?.classList.toggle("harmony-docked", mode === "docked");
  if (mode !== "floating") {
    ui.root.style.left = "";
    ui.root.style.top = "";
  }
}

function close() {
  stopChordAudio();
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  anchor?.classList.remove("chord-token-active");
  anchor = null;
  sticky = false;
  if (ui) {
    ui.root.hidden = true;
    ui.root.classList.remove("is-docked", "is-sheet");
  }
  document.querySelector("#appShell")?.classList.remove("harmony-docked");
  mode = "floating";
  announcePanel();
}

/* Only the transient preview needs placing. The docked column and the bottom
   sheet are laid out by the stylesheet. */
function reposition() {
  if (!ui || ui.root.hidden || !anchor) return;

  if (!anchor.isConnected) {
    close();
    return;
  }

  if (mode !== "floating") return;

  const target = anchor.getBoundingClientRect();
  const box = ui.root.getBoundingClientRect();
  const margin = 8;

  let left = target.left + target.width / 2 - box.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));

  let top = target.bottom + 10;
  if (top + box.height > window.innerHeight - margin) {
    const above = target.top - box.height - 10;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - box.height - margin);
  }

  ui.root.style.left = `${Math.round(left)}px`;
  ui.root.style.top = `${Math.round(top)}px`;
}

function renderReharmonization() {
  const panel = ui.root.querySelector(".reharm-panel");
  const collapse = ui.root.querySelector(".reharm-collapse");
  /* The small window shows only a shape and a way in; the panel always shows
     the suggestions unless they have been stood down. */
  panel.hidden = mode === "floating";
  ui.root.classList.toggle("is-reharmonizing", reharmonizing);
  panel.classList.toggle("is-collapsed", !reharmonizing);
  collapse.textContent = reharmonizing ? "Hide" : "Show";
  collapse.setAttribute("aria-expanded", String(reharmonizing));
  collapse.setAttribute("aria-label", reharmonizing
    ? "Hide the suggestions and show the chord shape larger"
    : "Show the suggestions");

  const original = anchor.dataset.originalChord || anchor.dataset.chord;
  const context = callbacks.getContext?.(anchor) || {};
  neighbours = { prevChord: context.prevChord || "", nextChord: context.nextChord || "" };

  /* Reads as the run of chords it sits in, then what the chord is doing there
     when the key is known well enough to say. Kept up while collapsed, since
     it is the one line that says where you are. */
  const numeral = context.key?.confident ? romanNumeral(original, context.key) : "";
  const shape = describeProgression({ ...context, symbol: original });
  renderContextLine({
    prevChord: context.prevChord,
    original,
    nextChord: context.nextChord,
    place: numeral && `${numeral} in ${context.key.name}`,
    shape: shape?.label
  });

  if (!reharmonizing) {
    selectedAlternative = null;
    showAlternative(anchor.dataset.chord);
    return;
  }

  const options = suggestReharmonizations(original, context);
  renderBandFilters(options);
  const showing = options.filter(candidate => !bands || bands.has(candidate.strength));

  const list = ui.root.querySelector(".reharm-options");
  list.replaceChildren();
  for (const candidate of showing) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "reharm-option";
    button.setAttribute("aria-pressed", "false");
    /* How far the suggestion reaches is shown as a deepening accent tint, so
       the row carries no label for it. Colour alone cannot be the whole
       message, so the words the generator chose for the band go in the
       accessible name and the tooltip instead. */
    button.dataset.strength = String(candidate.strength);
    const rub = candidate.transitionNote && candidate.rubs ? ", rubs against a neighbouring chord" : "";
    button.classList.toggle("has-rub", Boolean(candidate.rubs));
    button.title = `${candidate.flavor} \u00b7 ${candidate.strengthNote}${candidate.transitionNote ? `\n${candidate.transitionNote}` : ""}`;
    /* The degree sits on the row rather than only in the detail below it, so
       that reading down the list pairs each chord with its numeral over and
       over. That pairing is the thing worth building an ear for, and it cannot
       be built one selected row at a time. */
    const degreeSaid = candidate.numeral ? `, ${candidate.numeral}` : "";
    button.setAttribute("aria-label", `${candidate.symbol}${degreeSaid}, ${candidate.flavor}, ${candidate.strengthNote}${rub}`);
    const name = document.createElement("strong"); name.textContent = candidate.symbol;
    const flavor = document.createElement("span"); flavor.textContent = candidate.flavor;
    const degree = document.createElement("span");
    degree.className = "reharm-degree";
    degree.textContent = candidate.numeral;
    button.append(name, flavor, degree);
    button.addEventListener("click", () => {
      stopChordAudio();
      selectedAlternative = candidate;
      list.querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      showAlternative(candidate.symbol);
      const shared = candidate.commonNotes.length ? `Shared: ${candidate.commonNotes.join(" ")}.` : "No shared chord tones.";
      const added = candidate.addedNotes.length ? ` Adds: ${candidate.addedNotes.join(" ")}.` : "";
      const removed = candidate.removedNotes.length ? ` Removes: ${candidate.removedNotes.join(" ")}.` : "";
      const place = candidate.numeral
        ? ` ${candidate.numeral}, ${candidate.diatonic ? "inside" : "outside"} the key.`
        : "";
      const join = candidate.transitionNote ? ` ${candidate.transitionNote}` : "";
      ui.root.querySelector(".reharm-detail").textContent =
        `${candidate.explanation}${place} ${shared}${added}${removed}${join}`;
      ui.root.querySelector(".reharm-apply").disabled = !callbacks.onReplace || candidate.symbol === anchor.dataset.chord;
      ui.root.querySelector(".reharm-status").textContent = "";
      reposition();
    });
    list.append(button);
  }
  markScrollable(list);
  ui.root.querySelector(".reharm-detail").textContent = options.length
    ? (showing.length ? "" : "Nothing in the bands you have picked. Widen them to see the rest.")
    : "No alternatives found for this chord symbol.";
  ui.root.querySelector(".reharm-apply").disabled = true;
  ui.root.querySelector(".reharm-reset").hidden = !callbacks.onReplace || !anchor.classList.contains("is-reharmonized");
  renderAudioRow(original);
  ui.root.querySelector(".reharm-session").textContent = callbacks.onReplace ? "Drafts last until reload. Copy or save a new version to keep them." : "Explore colors here; use the main app to replace chords.";
  ui.root.querySelector(".reharm-status").textContent = "";
  renderApproaches(context);
  showAlternative(anchor.dataset.chord);
}

/* The run of chords, with the one being worked on picked out of it. Three
   chord names in a row say nothing about which of them is the subject, and the
   middle is only the middle while there is a chord on either side of it: at the
   start or end of a section there are two names and no way to tell them apart.
   So the chord is marked rather than positioned. */
function renderContextLine({ prevChord, original, nextChord, place, shape }) {
  const holder = ui.root.querySelector(".reharm-context");
  holder.replaceChildren();

  const run = document.createElement("span");
  run.className = "reharm-run";
  const steps = [prevChord, original, nextChord].filter(Boolean);
  steps.forEach((chord, at) => {
    if (at) {
      const arrow = document.createElement("span");
      arrow.className = "reharm-run-arrow";
      arrow.textContent = "\u2192";
      // Punctuation between the names, and nothing a reader needs said aloud.
      arrow.setAttribute("aria-hidden", "true");
      run.append(arrow);
    }
    const name = document.createElement("span");
    name.className = "reharm-run-chord";
    name.textContent = chord;
    if (chord === original && at === steps.indexOf(original)) {
      name.classList.add("is-here");
      name.setAttribute("aria-current", "true");
      const said = document.createElement("span");
      said.className = "sr-only";
      said.textContent = " (the chord you are changing)";
      name.append(said);
    }
    run.append(name);
  });
  holder.append(run);

  for (const text of [place, shape].filter(Boolean)) {
    const sep = document.createElement("span");
    sep.className = "reharm-run-sep";
    sep.textContent = "\u00b7";
    sep.setAttribute("aria-hidden", "true");
    const part = document.createElement("span");
    part.textContent = text;
    holder.append(sep, part);
  }
}

/* Where the list is capped it has to say so. A scrollbar that only appears
   once you are already scrolling is no help to someone deciding whether there
   is anything below, and the row cut in half at the bottom edge is too quiet
   to read as an invitation. A fade over the last of the list says it, and goes
   once there is nothing left under it. */
function markScrollable(list) {
  const update = () => {
    const more = list.scrollHeight - list.clientHeight - list.scrollTop > 1;
    list.classList.toggle("has-more", more);
  };
  if (!list.dataset.watched) {
    list.addEventListener("scroll", update, { passive: true });
    list.dataset.watched = "yes";
  }
  requestAnimationFrame(update);
}

/* One chip per band the list actually has something in, plus an All. Clicking
   a band while everything is showing narrows to that band alone, which is the
   move being reached for on a phone; after that the chips toggle, so two bands
   can be read together. Turning the last one off means all again rather than
   an empty list, because an empty list is never what was wanted. */
function renderBandFilters(options) {
  const holder = ui.root.querySelector(".reharm-filters");
  holder.replaceChildren();
  const counts = new Map();
  for (const candidate of options) counts.set(candidate.strength, (counts.get(candidate.strength) || 0) + 1);
  const present = [...counts.keys()].sort((one, other) => one - other);
  /* One band is not a choice, and no bands is not a list. */
  if (present.length < 2) return;
  const keyed = options.some(candidate => candidate.diatonic !== null);

  const chip = (label, pressed, detail, onPick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reharm-filter";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(pressed));
    button.setAttribute("aria-label", detail);
    button.addEventListener("click", () => { onPick(); renderReharmonization(); reposition(); });
    holder.append(button);
  };

  chip("All", !bands, `Show all ${options.length} suggestions`, () => { bands = null; });
  for (const band of present) {
    const label = reachChip(band, keyed);
    chip(`${label} ${counts.get(band)}`, Boolean(bands?.has(band)),
      `${counts.get(band)} suggestions: ${label.toLowerCase()}`,
      () => {
        if (!bands) { bands = new Set([band]); return; }
        bands.has(band) ? bands.delete(band) : bands.add(band);
        if (!bands.size) bands = null;
      });
  }
}

/* The chord in place: what came before it, the chord itself against whatever
   has been picked for it, and what follows. Hearing a suggestion on its own
   says how it sounds; hearing it between its neighbours says whether it works.
   A missing neighbour keeps its column so the middle stays where it was. */
function renderAudioRow(original) {
  const set = (selector, name, describe) => {
    const button = ui.root.querySelector(selector);
    const playable = name ? lookup(name).length : 0;
    button.textContent = name || "\u2014";
    button.disabled = !playable;
    button.setAttribute("aria-label", playable ? describe(name) : "No chord here");
  };
  set(".reharm-hear-prev", neighbours.prevChord, name => `Hear ${name}, the chord before this one`);
  set(".reharm-hear-original", original, name => `Hear ${name}, the chord as written`);
  set(".reharm-hear-next", neighbours.nextChord, name => `Hear ${name}, the chord after this one`);
}

/* Ways into the chord, for reading and hearing rather than for applying. The
   list refreshes as chords are selected, and the section keeps whatever open
   state it was left in. */
function renderApproaches(context) {
  const target = anchor.dataset.chord;
  const list = ui.root.querySelector(".approach-options");
  list.replaceChildren();

  for (const option of suggestApproaches(target, { prevChord: context.prevChord || "" })) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "approach-option";
    const name = document.createElement("strong");
    name.textContent = option.chords.join("  ");
    const label = document.createElement("span");
    label.textContent = option.alreadyThere ? `${option.label} · already here` : option.label;
    button.append(name, label);
    button.title = option.explanation;
    button.setAttribute("aria-label", `Hear ${option.chords.join(" then ")} into ${target}. ${option.explanation}`);
    button.addEventListener("click", () => hearApproach(option, target));
    list.append(button);
  }
  ui.root.querySelector(".approach-detail").textContent = "";
}

async function hearApproach(option, target) {
  const detail = ui.root.querySelector(".approach-detail");
  detail.textContent = option.explanation;
  // The target is played last, so the approach is heard arriving rather than
  // hanging unresolved.
  const voicings = [...option.chords, target].map(name => lookup(name)[0]).filter(Boolean);
  if (!voicings.length) {
    detail.textContent = "No playable shape found for this approach.";
    return;
  }
  try {
    await playChordSequence(voicings);
  } catch (error) {
    detail.textContent = error.message || "Audio preview unavailable.";
  }
}

function showAlternative(name) {
  const parsed = parseChordSymbol(name);
  symbol = parsed?.symbol || name;
  voicings = parsed ? lookup(symbol) : [];
  index = Math.min(CHOSEN.get(symbol) || 0, Math.max(0, voicings.length-1));
  ui.name.textContent = symbol;
  ui.quality.textContent = headDetail(parsed);
  render();
  /* The lower half of the middle column is whatever has been picked for this
     chord. Until something is, there is nothing to hear there that the button
     above it does not already play, so it says so with a dash. */
  const original = anchor ? (anchor.dataset.originalChord || anchor.dataset.chord) : "";
  const picked = symbol && symbol !== original;
  const hear = ui.root.querySelector(".reharm-hear");
  hear.textContent = picked ? symbol : "\u2014";
  hear.disabled = !picked || !voicings.length;
  hear.setAttribute("aria-label", picked ? `Hear ${symbol}, the chord you have picked` : "No chord picked yet");
}

async function hear(name, voicing) {
  if (!voicing) return;
  try {
    await playChordVoicing(voicing);
    ui.root.querySelector(".reharm-status").textContent = `Playing ${name}`;
  } catch (error) {
    ui.root.querySelector(".reharm-status").textContent = error.message || "Audio preview unavailable.";
  }
}
