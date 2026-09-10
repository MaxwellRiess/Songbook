/* Chord shape popover.

   Hovering a chord on a pointer device previews its shape; clicking (or tapping
   on a touch screen) pins it so the voicings can be stepped through.

   On a pointer device the window can be dragged by its header to park it clear
   of the lyrics. Once dragged it stays put for the session: selecting another
   chord swaps the contents and keeps the reharmonize panel open, rather than
   snapping the window back over the sheet. */

import { getVoicings, parseChordSymbol } from "./chord-voicings.js";
import { createChordDiagram, positionLabel } from "./chord-diagram.js";
import { describeProgression, suggestReharmonizations } from "./reharmonize.js";
import { romanNumeral } from "./song-key.js";
import { playChordSequence, playChordVoicing, stopChordAudio } from "./chord-audio.js";
import { suggestApproaches } from "./approach.js";

const STRENGTH_WORDS = {
  1: "gentler colour, adds notes only",
  2: "bolder change, same root",
  3: "boldest change, new root"
};
const SHOW_DELAY = 110;
const HIDE_DELAY = 240;
const CACHE = new Map();
const CHOSEN = new Map(); // remembers the voicing picked for each chord this session

let ui = null;
let anchor = null;
let symbol = null;
let voicings = [];
let index = 0;
let pinned = false;
let sheet = false;
let showTimer = 0;
let hideTimer = 0;
let callbacks = {};
let reharmonizing = false;
let selectedAlternative = null;
let moved = null; // viewport position the window was dragged to, kept for the session

export function initChordPopover(root, options = {}) {
  if (!root) return;
  callbacks = options;

  root.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const token = event.target.closest?.(".chord-token");
    if (!token || token === anchor) return;
    if (pinned) return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => open(token, { pinned: false }), SHOW_DELAY);
  });

  root.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse") return;
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
    if (pinned && token === anchor) close();
    else open(token, { pinned: true });
  });

  root.addEventListener("keydown", event => {
    const token = event.target.closest?.(".chord-token");
    if (token && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault(); open(token, { pinned: true });
      ui.root.querySelector(".reharm-toggle").focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!ui || ui.root.hidden) return;
    if (ui.root.contains(event.target)) return;
    if (event.target.closest?.(".chord-token")) return;
    close();
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
    if (moved && !sheet) reposition();
    else close();
  });
}

export function closeChordPopover() {
  close();
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
      <span class="chord-popover-grip" aria-hidden="true"></span>
      <div class="chord-popover-titles">
        <strong class="chord-popover-name"></strong>
        <span class="chord-popover-quality"></span>
      </div>
      <button type="button" class="chord-popover-snap" hidden aria-label="Move the window back to the chord" title="Move back to the chord">&#8617;</button>
      <button type="button" class="chord-popover-close" aria-label="Close chord shape">&times;</button>
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
      <p class="reharm-context"></p>
      <div class="reharm-options" role="group" aria-label="Alternative chords"></div>
      <div class="reharm-detail" aria-live="polite"></div>
      <div class="reharm-audio">
        <button type="button" class="reharm-hear-original">Hear original</button>
        <button type="button" class="reharm-hear">Hear choice</button>
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
    </section>
  `;

  document.body.append(root);

  ui = {
    root,
    head: root.querySelector(".chord-popover-head"),
    snap: root.querySelector(".chord-popover-snap"),
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
    if (event.pointerType === "mouse" && !pinned) scheduleHide();
  });
  root.querySelector(".chord-popover-close").addEventListener("click", () => {
    const previous = anchor;
    close();
    previous?.focus({ preventScroll: true });
  });
  ui.snap.addEventListener("click", () => {
    moved = null;
    updateMovedState();
    reposition();
  });
  initDrag(ui.head);
  ui.prev.addEventListener("click", () => step(-1));
  ui.next.addEventListener("click", () => step(1));
  root.querySelector(".reharm-toggle").addEventListener("click", () => {
    reharmonizing = !reharmonizing;
    pinned = true; clearTimeout(hideTimer);
    ui.root.classList.add("is-pinned");
    renderReharmonization(); reposition();
  });
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

function open(token, { pinned: shouldPin }) {
  stopChordAudio();
  const next = token.dataset.chord || token.textContent.trim();
  const parsed = parseChordSymbol(next);

  ensureUi();
  // Selecting another chord from an open, pinned window keeps the panel showing
  // so the same comparison carries across chords.
  const keepPanel = !ui.root.hidden && pinned && reharmonizing;
  anchor?.classList.remove("chord-token-active");
  anchor = token;
  reharmonizing = keepPanel;
  selectedAlternative = null;
  symbol = parsed ? parsed.symbol : next;
  pinned = shouldPin;
  sheet = !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  voicings = parsed ? lookup(symbol) : [];
  index = Math.min(CHOSEN.get(symbol) || 0, Math.max(voicings.length - 1, 0));

  ui.name.textContent = symbol;
  ui.quality.textContent = parsed ? `${parsed.qualityName} · ${parsed.notes.join(" ")}` : "unrecognised chord";
  ui.root.classList.toggle("is-sheet", sheet);
  ui.root.classList.toggle("is-pinned", pinned);
  ui.root.hidden = false;
  token.classList.add("chord-token-active");
  updateMovedState();

  render();
  renderReharmonization();
  reposition();
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
  pinned = true;
  ui.root.classList.add("is-pinned");
  clearTimeout(hideTimer);
  render();
  reposition();
}

function scheduleHide() {
  if (pinned) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(close, HIDE_DELAY);
}

function close() {
  stopChordAudio();
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  anchor?.classList.remove("chord-token-active");
  anchor = null;
  pinned = false;
  if (ui) {
    ui.root.hidden = true;
    ui.root.classList.remove("is-pinned", "is-dragging");
  }
}

function reposition() {
  if (!ui || ui.root.hidden || !anchor) return;

  if (!anchor.isConnected) {
    close();
    return;
  }

  if (sheet) {
    ui.root.style.left = "";
    ui.root.style.top = "";
    return;
  }

  // A dragged window keeps its place; opening the panel only pulls it back into view.
  if (moved) {
    place(moved.left, moved.top);
    return;
  }

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

/* Clamping sits apart from the DOM so it can be tested. A window wider or
   taller than the viewport pins to the top-left margin rather than going
   off-screen, and the scrollable body handles the overflow. */
export function clampWindowPosition({ left, top, width, height, viewportWidth, viewportHeight, margin = 8 }) {
  const limit = (value, extent, viewport) =>
    Math.round(Math.max(margin, Math.min(value, Math.max(margin, viewport - extent - margin))));
  return {
    left: limit(left, width, viewportWidth),
    top: limit(top, height, viewportHeight)
  };
}

function place(left, top) {
  const box = ui.root.getBoundingClientRect();
  const spot = clampWindowPosition({
    left, top,
    width: box.width, height: box.height,
    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight
  });
  moved = spot;
  ui.root.style.left = `${spot.left}px`;
  ui.root.style.top = `${spot.top}px`;
  updateMovedState();
}

/* A parked window carries .is-dragged so the narrow-viewport layout rules stop
   pinning it to the bottom of the screen. */
function updateMovedState() {
  if (!ui) return;
  const parked = Boolean(moved) && !sheet;
  ui.root.classList.toggle("is-dragged", parked);
  ui.snap.hidden = !parked;
}

function initDrag(head) {
  head.addEventListener("pointerdown", (event) => {
    if (sheet) return; // the mobile sheet is already docked clear of the lyrics
    if (event.target.closest("button")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const box = ui.root.getBoundingClientRect();
    const grabX = event.clientX - box.left;
    const grabY = event.clientY - box.top;

    // Grabbing the window pins it, so a hover preview cannot fade mid-drag.
    pinned = true;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    ui.root.classList.add("is-pinned", "is-dragging");
    head.setPointerCapture(event.pointerId);
    event.preventDefault();

    const onMove = (move) => place(move.clientX - grabX, move.clientY - grabY);
    const onEnd = () => {
      head.removeEventListener("pointermove", onMove);
      head.removeEventListener("pointerup", onEnd);
      head.removeEventListener("pointercancel", onEnd);
      head.releasePointerCapture?.(event.pointerId);
      ui.root.classList.remove("is-dragging");
      updateMovedState();
    };

    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onEnd);
    head.addEventListener("pointercancel", onEnd);
  });
}

function renderReharmonization() {
  const toggle = ui.root.querySelector(".reharm-toggle");
  toggle.setAttribute("aria-pressed", String(reharmonizing));
  toggle.setAttribute("aria-expanded", String(reharmonizing));
  ui.root.querySelector(".reharm-panel").hidden = !reharmonizing;
  ui.root.classList.toggle("is-reharmonizing", reharmonizing);
  if (!reharmonizing) {
    selectedAlternative = null;
    showAlternative(anchor.dataset.chord);
    return;
  }
  const original = anchor.dataset.originalChord || anchor.dataset.chord;
  const context = callbacks.getContext?.(anchor) || {};
  const options = suggestReharmonizations(original, context);
  /* Reads as the run of chords it sits in, then what the chord is doing there
     when the key is known well enough to say. */
  const run = [context.prevChord, original, context.nextChord].filter(Boolean).join(" → ");
  const numeral = context.key?.confident ? romanNumeral(original, context.key) : "";
  const shape = describeProgression({ ...context, symbol: original });
  ui.root.querySelector(".reharm-context").textContent = [
    run,
    numeral && `${numeral} in ${context.key.name}`,
    shape?.label
  ].filter(Boolean).join(" · ");
  const list = ui.root.querySelector(".reharm-options");
  list.replaceChildren();
  for (const candidate of options) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "reharm-option";
    button.setAttribute("aria-pressed", "false");
    /* Strength is shown as a deepening accent tint, so the row carries no
       label for it. Colour alone cannot be the whole message, so the words go
       in the accessible name and the tooltip instead. */
    button.dataset.strength = String(candidate.strength);
    const rub = candidate.transitionNote && candidate.rubs ? ", rubs against a neighbouring chord" : "";
    button.classList.toggle("has-rub", Boolean(candidate.rubs));
    button.title = `${candidate.flavor} · ${STRENGTH_WORDS[candidate.strength]}${candidate.transitionNote ? `\n${candidate.transitionNote}` : ""}`;
    button.setAttribute("aria-label", `${candidate.symbol}, ${candidate.flavor}, ${STRENGTH_WORDS[candidate.strength]}${rub}`);
    const name = document.createElement("strong"); name.textContent = candidate.symbol;
    const flavor = document.createElement("span"); flavor.textContent = candidate.flavor;
    button.append(name, flavor);
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
  ui.root.querySelector(".reharm-detail").textContent = options.length ? "" : "No alternatives found for this chord symbol.";
  ui.root.querySelector(".reharm-apply").disabled = true;
  ui.root.querySelector(".reharm-reset").hidden = !callbacks.onReplace || !anchor.classList.contains("is-reharmonized");
  ui.root.querySelector(".reharm-hear-original").textContent = `Hear original ${original}`;
  ui.root.querySelector(".reharm-hear-original").disabled = !lookup(original).length;
  ui.root.querySelector(".reharm-session").textContent = callbacks.onReplace ? "Drafts last until reload. Copy or save a new version to keep them." : "Explore colors here; use the main app to replace chords.";
  ui.root.querySelector(".reharm-status").textContent = "";
  renderApproaches(context);
  showAlternative(anchor.dataset.chord);
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
  ui.quality.textContent = parsed ? `${parsed.qualityName} · ${parsed.notes.join(" ")}` : "unrecognised chord";
  render();
  ui.root.querySelector(".reharm-hear").textContent = `Hear ${symbol}`;
  ui.root.querySelector(".reharm-hear").disabled = !voicings.length;
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
