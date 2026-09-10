/* Derives the theme's colour tokens from a chosen main and accent colour.

   Every token keeps the lightness and the chroma balance Pebble was designed
   with, and takes its hue from the chosen colour, so text stays as legible on
   any hue as it is on the default green. Chroma scales with how saturated the
   choice is, capped so surfaces stay a tint rather than a wash.

   Every token in a family shares the chosen hue exactly. Pebble drifts its own
   hues a little between tokens, but hue degrees are not perceptually even: the
   26 degrees between its accent and its palest accent tint read as one green
   there and as orange against pink in the warm half of the wheel. Choosing the
   two default colours below is treated as choosing no tint at all, so Pebble's
   own values stay in charge of the default appearance and none of this runs.

   Kept free of the DOM and of browser storage so the colour maths can be
   tested on its own. */

/* A choice at this chroma leaves the palette exactly as designed, which is why
   the two defaults below sit on it. */
const MAIN_REFERENCE_CHROMA = 0.0518;
const ACCENT_REFERENCE_CHROMA = 0.0573;

/* Ceilings, in OKLCH chroma. Surfaces carry text, so they stay close to grey
   however vivid the choice; the accent is allowed to be a real colour. */
const MAIN_CHROMA_CEILING = 0.055;
const ACCENT_CHROMA_CEILING = 0.16;
const MIN_SATURATION = 0.15;
const MAX_SATURATION = 3;

export const DEFAULT_MAIN = "#526141";
export const DEFAULT_ACCENT = "#436348";

/* Lightness and chroma measured from Pebble. */
const TOKENS = {
  light: {
    "--bg": { l: 91.83, c: 0.0144, family: "main" },
    "--panel": { l: 97.67, c: 0.008, family: "main" },
    "--panel-muted": { l: 94.73, c: 0.0171, family: "main" },
    "--ink": { l: 32.68, c: 0.0242, family: "main" },
    "--muted": { l: 50.1, c: 0.0308, family: "main" },
    "--line": { l: 85.21, c: 0.0251, family: "main" },
    "--shade": { l: 33.84, c: 0.0502, family: "main", alpha: 0.12 },
    "--accent": { l: 46.67, c: 0.0573, family: "accent" },
    "--accent-strong": { l: 42.45, c: 0.0564, family: "accent" },
    "--accent-mild": { l: 94.5, c: 0.03, family: "accent" },
    "--accent-firm": { l: 90, c: 0.052, family: "accent" },
    "--accent-soft": { l: 92.15, c: 0.0263, family: "accent" }
  },
  dark: {
    "--bg": { l: 23.79, c: 0.015, family: "main" },
    "--panel": { l: 30.32, c: 0.0217, family: "main" },
    "--panel-muted": { l: 34.76, c: 0.0264, family: "main" },
    "--ink": { l: 95.18, c: 0.0164, family: "main" },
    "--muted": { l: 78.31, c: 0.032, family: "main" },
    "--line": { l: 45.57, c: 0.0319, family: "main" },
    "--shade": { l: 0, c: 0, family: "main", alpha: 0.25 },
    "--accent": { l: 82.08, c: 0.0681, family: "accent" },
    "--accent-strong": { l: 86.5, c: 0.0626, family: "accent" },
    "--accent-mild": { l: 34.5, c: 0.042, family: "accent" },
    "--accent-firm": { l: 41, c: 0.064, family: "accent" },
    "--accent-soft": { l: 41.16, c: 0.0425, family: "accent" }
  }
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

const srgbToLinear = (channel) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (channel) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

export function hexToOklch(hex) {
  if (!isHexColor(hex)) return null;
  const value = hex.trim().slice(1);
  const [r, g, b] = [0, 2, 4].map((at) => srgbToLinear(parseInt(value.slice(at, at + 2), 16) / 255));

  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
  const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  const b2 = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;

  return {
    l: lightness * 100,
    c: Math.hypot(a, b2),
    h: ((Math.atan2(b2, a) * 180) / Math.PI + 360) % 360
  };
}

/* OKLCH describes colours sRGB cannot show. Clipping each channel to range
   would swing the hue — a vivid orange clips its red channel first and lands on
   pink — so chroma is reduced instead until the colour fits, keeping the hue and
   lightness that were asked for. This is what CSS Color 4 gamut mapping does. */
function oklchToLinearRgb({ l, c, h }) {
  const lightness = l / 100;
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short
  ];
}

const TOLERANCE = 1e-5;
const fits = (colour) => oklchToLinearRgb(colour).every((channel) => channel >= -TOLERANCE && channel <= 1 + TOLERANCE);

export function fitToGamut({ l, c, h }) {
  if (fits({ l, c, h })) return { l, c, h };
  let reachable = 0;
  let tooMuch = c;
  for (let step = 0; step < 24; step += 1) {
    const middle = (reachable + tooMuch) / 2;
    if (fits({ l, c: middle, h })) reachable = middle;
    else tooMuch = middle;
  }
  return { l, c: reachable, h };
}

export function oklchToHex(colour) {
  return `#${oklchToLinearRgb(fitToGamut(colour))
    .map((channel) => Math.round(clamp(linearToSrgb(clamp(channel, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/* Relative luminance contrast, so the tests can hold the derived palette to a
   readability floor rather than trusting the lightness targets by eye. */
export function contrastRatio(oneHex, otherHex) {
  const luminance = (hex) => {
    const value = hex.slice(1);
    const [r, g, b] = [0, 2, 4].map((at) => srgbToLinear(parseInt(value.slice(at, at + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(oneHex), luminance(otherHex)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function saturation(chosenChroma, reference) {
  return clamp(chosenChroma / reference, MIN_SATURATION, MAX_SATURATION);
}

/* Returns { "--bg": "#...", ... } for one mode, or null if either colour is
   not a hex value. */
export function derivePalette({ main = DEFAULT_MAIN, accent = DEFAULT_ACCENT, mode = "light" } = {}) {
  const chosenMain = hexToOklch(main);
  const chosenAccent = hexToOklch(accent);
  const tokens = TOKENS[mode === "dark" ? "dark" : "light"];
  if (!chosenMain || !chosenAccent) return null;

  const families = {
    main: {
      hue: chosenMain.h,
      saturation: saturation(chosenMain.c, MAIN_REFERENCE_CHROMA),
      ceiling: MAIN_CHROMA_CEILING
    },
    accent: {
      hue: chosenAccent.h,
      saturation: saturation(chosenAccent.c, ACCENT_REFERENCE_CHROMA),
      ceiling: ACCENT_CHROMA_CEILING
    }
  };

  const palette = {};
  for (const [name, token] of Object.entries(tokens)) {
    const family = families[token.family];
    const hex = oklchToHex({
      l: token.l,
      c: clamp(token.c * family.saturation, 0, family.ceiling),
      h: family.hue
    });
    palette[name] = token.alpha === undefined ? hex : rgba(hex, token.alpha);
  }
  return palette;
}

function rgba(hex, alpha) {
  const value = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/* Both modes at once, plus the choice that produced them. This is what gets
   cached so the pre-paint script can apply a tint without redoing the maths. */
export function deriveTint({ main = DEFAULT_MAIN, accent = DEFAULT_ACCENT } = {}) {
  const light = derivePalette({ main, accent, mode: "light" });
  const dark = derivePalette({ main, accent, mode: "dark" });
  if (!light || !dark) return null;
  return { version: 1, main, accent, light, dark };
}

export function isDefaultTint({ main, accent } = {}) {
  return (main || DEFAULT_MAIN).toLowerCase() === DEFAULT_MAIN &&
    (accent || DEFAULT_ACCENT).toLowerCase() === DEFAULT_ACCENT;
}
