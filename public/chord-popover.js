/* Chord shape popover.

   Hovering a chord on a pointer device previews its shape; clicking (or tapping
   on a touch screen) pins it so the voicings can be stepped through. */

import { getVoicings, parseChordSymbol } from "./chord-voicings.js";
import { createChordDiagram, positionLabel } from "./chord-diagram.js";

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

export function initChordPopover(root) {
  if (!root) return;

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

  document.addEventListener("pointerdown", (event) => {
    if (!ui || ui.root.hidden) return;
    if (ui.root.contains(event.target)) return;
    if (event.target.closest?.(".chord-token")) return;
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (!ui || ui.root.hidden) return;
    if (event.key === "Escape") {
      close();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
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
  root.querySelector(".chord-popover-close").addEventListener("click", close);
  ui.prev.addEventListener("click", () => step(-1));
  ui.next.addEventListener("click", () => step(1));

  return ui;
}

function open(token, { pinned: shouldPin }) {
  const next = token.dataset.chord || token.textContent.trim();
  const parsed = parseChordSymbol(next);

  ensureUi();
  anchor?.classList.remove("chord-token-active");
  anchor = token;
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
  clearTimeout(hideTimer);
  hideTimer = setTimeout(close, HIDE_DELAY);
}

function close() {
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
