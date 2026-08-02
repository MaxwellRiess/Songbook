/* Draws a voicing from chord-voicings.js as an SVG fretboard diagram.
   Colours come from CSS custom properties so the themes carry through. */

import { diagramWindow } from "./chord-voicings.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/* The left gutter has to fit a two-digit position label such as "10fr". */
const LEFT = 30;
const RIGHT = 14;
const TOP = 36;
const STRING_GAP = 18;
const FRET_GAP = 25;
const FRET_COUNT = 5;
const WIDTH = LEFT + STRING_GAP * 5 + RIGHT;
const BOARD_BOTTOM = TOP + FRET_GAP * FRET_COUNT;
const HEIGHT = BOARD_BOTTOM + 24;

export function createChordDiagram(voicing, options = {}) {
  const { baseFret } = diagramWindow(voicing, FRET_COUNT);
  const showNotes = options.showNotes !== false;

  const svg = element("svg", {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    class: "chord-diagram",
    role: "img",
    "aria-label": describeVoicing(voicing, baseFret)
  });

  const board = element("g", { class: "chord-diagram-board" });

  // Frets.
  for (let fret = 0; fret <= FRET_COUNT; fret += 1) {
    const y = TOP + fret * FRET_GAP;
    const nut = fret === 0 && baseFret === 1;
    board.append(
      element("line", {
        x1: LEFT,
        y1: y,
        x2: LEFT + STRING_GAP * 5,
        y2: y,
        class: nut ? "chord-diagram-nut" : "chord-diagram-fret"
      })
    );
  }

  // Strings.
  for (let string = 0; string < 6; string += 1) {
    const x = LEFT + string * STRING_GAP;
    board.append(
      element("line", { x1: x, y1: TOP, x2: x, y2: BOARD_BOTTOM, class: "chord-diagram-string" })
    );
  }

  svg.append(board);

  if (baseFret > 1) {
    svg.append(
      text(LEFT - 8, TOP + FRET_GAP * 0.6, `${baseFret}fr`, "chord-diagram-position", "end")
    );
  }

  // Open and muted markers above the nut.
  for (let string = 0; string < 6; string += 1) {
    const fret = voicing.frets[string];
    const x = LEFT + string * STRING_GAP;
    if (fret === null) {
      svg.append(text(x, TOP - 9, "×", "chord-diagram-mute"));
    } else if (fret === 0) {
      svg.append(element("circle", { cx: x, cy: TOP - 13, r: 4.2, class: "chord-diagram-open" }));
    }
  }

  if (voicing.barre) {
    const { fret, from, to } = voicing.barre;
    const row = fret - baseFret;
    if (row >= 0 && row < FRET_COUNT) {
      const y = TOP + (row + 0.5) * FRET_GAP;
      svg.append(
        element("rect", {
          x: LEFT + from * STRING_GAP - 7,
          y: y - 7,
          width: (to - from) * STRING_GAP + 14,
          height: 14,
          rx: 7,
          class: "chord-diagram-barre"
        })
      );
    }
  }

  // Fingered notes. Strings under a barre share one dot and one finger number.
  for (let string = 0; string < 6; string += 1) {
    const fret = voicing.frets[string];
    if (!fret) continue;

    const row = fret - baseFret;
    if (row < 0 || row >= FRET_COUNT) continue;
    if (voicing.barre && voicing.barre.fret === fret) continue;

    const x = LEFT + string * STRING_GAP;
    const y = TOP + (row + 0.5) * FRET_GAP;
    svg.append(element("circle", { cx: x, cy: y, r: 7, class: "chord-diagram-dot" }));

    const finger = voicing.fingers[string];
    if (finger) svg.append(text(x, y + 3.6, String(finger), "chord-diagram-finger"));
  }

  if (voicing.barre) {
    const row = voicing.barre.fret - baseFret;
    if (row >= 0 && row < FRET_COUNT) {
      const midpoint = (voicing.barre.from + voicing.barre.to) / 2;
      svg.append(
        text(
          LEFT + midpoint * STRING_GAP,
          TOP + (row + 0.5) * FRET_GAP + 3.6,
          "1",
          "chord-diagram-finger"
        )
      );
    }
  }

  if (showNotes && voicing.noteNames) {
    for (let string = 0; string < 6; string += 1) {
      const name = voicing.noteNames[string];
      if (!name) continue;
      svg.append(
        text(LEFT + string * STRING_GAP, BOARD_BOTTOM + 16, name, "chord-diagram-note")
      );
    }
  }

  return svg;
}

export function describeVoicing(voicing, baseFret) {
  const parts = voicing.frets.map((fret, string) => {
    const label = ["low E", "A", "D", "G", "B", "high E"][string];
    if (fret === null) return `${label} muted`;
    if (fret === 0) return `${label} open`;
    return `${label} fret ${fret}`;
  });
  const position = baseFret > 1 ? ` starting at fret ${baseFret}` : "";
  return `${voicing.symbol} chord shape${position}: ${parts.join(", ")}`;
}

/* "Open position" only means anything when the diagram still shows the nut,
   so the label is decided by the drawn window rather than by the frets alone. */
export function positionLabel(voicing) {
  if (voicing.position === 0) return "open strings";

  const { baseFret } = diagramWindow(voicing, FRET_COUNT);
  const open = voicing.frets.some((fret) => fret === 0);
  if (baseFret === 1 && open) return "open position";
  return `fret ${voicing.position}`;
}

function element(name, attributes) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function text(x, y, content, className, anchor = "middle") {
  const node = element("text", { x, y, class: className, "text-anchor": anchor });
  node.textContent = content;
  return node;
}
