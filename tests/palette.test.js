import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ACCENT,
  DEFAULT_MAIN,
  contrastRatio,
  derivePalette,
  deriveTint,
  hexToOklch,
  isDefaultTint,
  isHexColor,
  oklchToHex
} from "../public/palette.js";

const PEBBLE = {
  light: {
    "--bg": "#e1e6dc",
    "--panel": "#f7f8f2",
    "--panel-muted": "#eaf0e4",
    "--ink": "#2d382d",
    "--muted": "#5b6857",
    "--line": "#c9d2c1",
    "--accent": "#436348",
    "--accent-strong": "#38573d",
    "--accent-mild": "#e0f3e2",
    "--accent-firm": "#c7e8cb",
    "--accent-soft": "#dfe9d7",
    "--shade": "rgba(41,62,37,0.12)"
  },
  dark: {
    "--bg": "#19211c",
    "--panel": "#26322a",
    "--panel-muted": "#303e33",
    "--ink": "#edf1e5",
    "--muted": "#b1bda8",
    "--line": "#4b5c4d",
    "--accent": "#b5cea0",
    "--accent-strong": "#c3dcb2",
    "--accent-mild": "#323e27",
    "--accent-firm": "#3e522c",
    "--accent-soft": "#3d513c",
    "--shade": "rgba(0,0,0,0.25)"
  }
};

const HUES = ["#b23a48", "#c98a1e", "#1e7fc9", "#7b4fc9", "#118a72", "#8a8a8a", "#000000", "#ffffff"];

/* Picking the two defaults is treated as picking no tint, so Pebble's own
   values stay in charge and the derivation never runs. This holds the
   derivation close to Pebble anyway, as a guard against it drifting. */
test("the default choice lands within a few steps of Pebble in both modes", () => {
  const channels = (colour) => colour.startsWith("#")
    ? [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16))
    : colour.slice(colour.indexOf("(") + 1, -1).split(",").slice(0, 3).map(Number);
  for (const mode of ["light", "dark"]) {
    const palette = derivePalette({ mode });
    for (const [name, shipped] of Object.entries(PEBBLE[mode])) {
      const drift = Math.max(...channels(shipped).map((value, at) => Math.abs(value - channels(palette[name])[at])));
      assert.ok(drift <= 15, `${mode} ${name}: ${shipped} became ${palette[name]}, off by ${drift}`);
    }
  }
});

test("every token carries the hue that was chosen", () => {
  // The guard against sRGB clipping swinging a hue: a vivid orange clips its
  // red channel first and would otherwise land on pink.
  for (const colour of ["#c9601e", "#e0b400", "#1e7fc9", "#c92e5a"]) {
    for (const mode of ["light", "dark"]) {
      const palette = derivePalette({ main: colour, accent: colour, mode });
      const asked = hexToOklch(colour).h;
      for (const name of ["--accent", "--accent-strong", "--accent-mild", "--accent-soft", "--bg", "--panel"]) {
        const got = hexToOklch(palette[name]).h;
        const apart = Math.abs(((got - asked + 540) % 360) - 180);
        assert.ok(apart <= 3, `${mode} ${name} with ${colour} sat at ${got.toFixed(1)}, asked ${asked.toFixed(1)}`);
      }
    }
  }
});

test("hex and OKLCH round-trip", () => {
  for (const hex of [...HUES, DEFAULT_MAIN, DEFAULT_ACCENT, "#e1e6dc"]) {
    assert.equal(oklchToHex(hexToOklch(hex)), hex.toLowerCase());
  }
});

test("body text keeps a readable contrast against its surfaces on any hue", () => {
  for (const colour of HUES) {
    for (const mode of ["light", "dark"]) {
      const palette = derivePalette({ main: colour, accent: colour, mode });
      for (const surface of ["--bg", "--panel", "--panel-muted"]) {
        const ratio = contrastRatio(palette["--ink"], palette[surface]);
        assert.ok(ratio >= 7, `${mode} ink on ${surface} with ${colour} was ${ratio.toFixed(2)}`);
      }
      const muted = contrastRatio(palette["--muted"], palette["--bg"]);
      assert.ok(muted >= 4.5, `${mode} muted on bg with ${colour} was ${muted.toFixed(2)}`);
    }
  }
});

test("the accent stays readable on the panel it sits on", () => {
  for (const colour of HUES) {
    const light = derivePalette({ main: colour, accent: colour, mode: "light" });
    const dark = derivePalette({ main: colour, accent: colour, mode: "dark" });
    const lightRatio = contrastRatio(light["--accent-strong"], light["--panel"]);
    const darkRatio = contrastRatio(dark["--accent-strong"], dark["--panel"]);
    assert.ok(lightRatio >= 4.5, `light accent with ${colour} was ${lightRatio.toFixed(2)}`);
    assert.ok(darkRatio >= 4.5, `dark accent with ${colour} was ${darkRatio.toFixed(2)}`);
  }
});

test("the three suggestion-strength tints stay distinct and in order", () => {
  // The reharmonize rows are told apart by how much accent they carry, so the
  // steps have to stay separable whatever colour is chosen.
  for (const colour of HUES) {
    for (const mode of ["light", "dark"]) {
      const palette = derivePalette({ main: colour, accent: colour, mode });
      const steps = [palette["--panel"], palette["--accent-mild"], palette["--accent-firm"]];
      const against = contrastRatio(palette["--ink"], steps[2]);
      assert.ok(against >= 7, `${mode} ink on the strongest tint with ${colour} was ${against.toFixed(2)}`);
      // Neighbouring steps have to be separable at a glance, not merely unequal.
      for (const [at, label] of [[0, "panel to mild"], [1, "mild to firm"]]) {
        const apart = contrastRatio(steps[at], steps[at + 1]);
        assert.ok(apart >= 1.08, `${mode} ${colour}: ${label} was only ${apart.toFixed(3)} apart`);
      }
    }
  }
});

test("a vivid choice tints the surfaces without washing them out", () => {
  const vivid = derivePalette({ main: "#ff0000", accent: "#ff0000", mode: "light" });
  const surface = hexToOklch(vivid["--bg"]);
  assert.ok(surface.c <= 0.056, `background chroma reached ${surface.c.toFixed(4)}`);
  // The hue still comes through, so the choice is visible rather than ignored.
  assert.ok(surface.c >= 0.02, `background chroma was only ${surface.c.toFixed(4)}`);
  assert.ok(Math.abs(surface.h - hexToOklch("#ff0000").h) < 1);
});

test("a greyscale choice gives greyscale surfaces", () => {
  const grey = derivePalette({ main: "#808080", accent: "#808080", mode: "light" });
  assert.ok(hexToOklch(grey["--bg"]).c < 0.006);
});

test("deriveTint carries both modes and the choice that made them", () => {
  const tint = deriveTint({ main: "#1e7fc9", accent: "#c98a1e" });
  assert.equal(tint.version, 1);
  assert.equal(tint.main, "#1e7fc9");
  assert.equal(tint.accent, "#c98a1e");
  assert.deepEqual(Object.keys(tint.light).sort(), Object.keys(PEBBLE.light).sort());
  assert.notDeepEqual(tint.light, tint.dark);
  // Two different choices must not collapse to the same palette.
  assert.notDeepEqual(tint.light, deriveTint({ main: "#c98a1e", accent: "#1e7fc9" }).light);
});

test("rejects anything that is not a six-digit hex colour", () => {
  for (const bad of ["red", "#fff", "#12345g", "", null, "rgb(0,0,0)"]) {
    assert.equal(isHexColor(bad), false, String(bad));
    assert.equal(hexToOklch(bad), null, String(bad));
    assert.equal(derivePalette({ main: bad }), null, String(bad));
    assert.equal(deriveTint({ accent: bad }), null, String(bad));
  }
  assert.ok(isHexColor("#AABBCC"));
  assert.equal(isHexColor(undefined), false);
  // An absent colour is not a bad one: it means fall back to the default.
  assert.deepEqual(derivePalette({ main: undefined }), derivePalette({}));
});

test("recognises the default choice so it is stored as no choice at all", () => {
  assert.ok(isDefaultTint({ main: DEFAULT_MAIN, accent: DEFAULT_ACCENT }));
  assert.ok(isDefaultTint({ main: DEFAULT_MAIN.toUpperCase(), accent: DEFAULT_ACCENT.toUpperCase() }));
  assert.ok(isDefaultTint({}));
  assert.ok(!isDefaultTint({ main: "#1e7fc9", accent: DEFAULT_ACCENT }));
});
