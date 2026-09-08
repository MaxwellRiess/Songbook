/* Chord shape popover.

   Hovering a chord on a pointer device previews its shape; clicking (or tapping
   on a touch screen) pins it so the voicings can be stepped through. */

import { getVoicings, parseChordSymbol } from "./chord-voicings.js";
import { createChordDiagram, positionLabel } from "./chord-diagram.js";
import { suggestReharmonizations } from "./reharmonize.js";
import { playChordVoicing, stopChordAudio } from "./chord-audio.js";

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
  window.addEventListener("resize", () => close());
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
      <div class="chord-popover-titles">
        <strong class="chord-popover-name"></strong>
        <span class="chord-popover-quality"></span>
      </div>
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
      <p class="reharm-hint">Choose a color, hear it, then try it in this position. Check changes against the melody.</p>
      <div class="reharm-options" role="group" aria-label="Alternative chords"></div>
      <div class="reharm-detail" aria-live="polite"></div>
      <div class="reharm-audio">
        <button type="button" class="reharm-hear-original">Hear original</button>
        <button type="button" class="reharm-hear">Hear choice</button>
      </div>
      <p class="reharm-audio-note">Synthesized standard-tuning voicing, without capo.</p>
      <button type="button" class="reharm-apply" disabled>Use this chord</button>
      <button type="button" class="reharm-reset" hidden>Restore original chord</button>
      <p class="reharm-session">Changes are a draft. Copy or save a new version to keep them.</p>
      <p class="reharm-status" role="status"></p>
    </section>
  `;

  document.body.append(root);

  ui = {
    root,
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
  anchor?.classList.remove("chord-token-active");
  anchor = token;
  reharmonizing = false;
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
    ui.root.classList.remove("is-pinned");
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
  ui.root.querySelector(".reharm-context").textContent = `Original ${original}${context.nextChord ? ` → next ${context.nextChord}` : ""}`;
  const list = ui.root.querySelector(".reharm-options");
  list.replaceChildren();
  for (const candidate of options) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "reharm-option";
    button.setAttribute("aria-pressed", "false");
    const name = document.createElement("strong"); name.textContent = candidate.symbol;
    const flavor = document.createElement("span"); flavor.textContent = candidate.flavor;
    const strength = document.createElement("small"); strength.textContent = candidate.bold ? "Bolder change" : "Gentler color";
    button.append(name, flavor, strength);
    button.addEventListener("click", () => {
      stopChordAudio();
      selectedAlternative = candidate;
      list.querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      showAlternative(candidate.symbol);
      const shared = candidate.commonNotes.length ? `Shared: ${candidate.commonNotes.join(" ")}.` : "No shared chord tones.";
      const added = candidate.addedNotes.length ? ` Adds: ${candidate.addedNotes.join(" ")}.` : "";
      const removed = candidate.removedNotes.length ? ` Removes: ${candidate.removedNotes.join(" ")}.` : "";
      ui.root.querySelector(".reharm-detail").textContent = `${candidate.explanation} ${shared}${added}${removed}`;
      ui.root.querySelector(".reharm-apply").disabled = !callbacks.onReplace || candidate.symbol === anchor.dataset.chord;
      ui.root.querySelector(".reharm-status").textContent = "";
      reposition();
    });
    list.append(button);
  }
  ui.root.querySelector(".reharm-detail").textContent = options.length ? "Select an alternative to inspect its notes and guitar shapes." : "No alternatives found for this chord symbol.";
  ui.root.querySelector(".reharm-apply").disabled = true;
  ui.root.querySelector(".reharm-reset").hidden = !callbacks.onReplace || !anchor.classList.contains("is-reharmonized");
  ui.root.querySelector(".reharm-hear-original").textContent = `Hear original ${original}`;
  ui.root.querySelector(".reharm-hear-original").disabled = !lookup(original).length;
  ui.root.querySelector(".reharm-session").textContent = callbacks.onReplace ? "Drafts last until reload. Copy or save a new version to keep them." : "Explore colors here; use the main app to replace chords.";
  ui.root.querySelector(".reharm-status").textContent = "";
  showAlternative(anchor.dataset.chord);
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
