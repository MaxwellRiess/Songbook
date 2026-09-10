import assert from "node:assert/strict";
import test from "node:test";
import { clampWindowPosition } from "../public/chord-popover.js";

const viewport = { viewportWidth: 1280, viewportHeight: 800 };
const window232 = { width: 232, height: 300, ...viewport };

test("keeps a dragged position untouched when it already fits", () => {
  assert.deepEqual(clampWindowPosition({ left: 640, top: 200, ...window232 }), { left: 640, top: 200 });
});

test("holds the window inside the right and bottom edges", () => {
  assert.deepEqual(
    clampWindowPosition({ left: 1400, top: 900, ...window232 }),
    { left: 1280 - 232 - 8, top: 800 - 300 - 8 }
  );
});

test("holds the window inside the left and top edges", () => {
  assert.deepEqual(clampWindowPosition({ left: -300, top: -50, ...window232 }), { left: 8, top: 8 });
});

test("pins to the margin when the window is larger than the viewport", () => {
  // The reharmonize panel can outgrow a short viewport; its own scrolling body
  // handles the overflow, so the window must not drift off-screen instead.
  assert.deepEqual(
    clampWindowPosition({ left: 40, top: 40, width: 400, height: 900, viewportWidth: 360, viewportHeight: 700 }),
    { left: 8, top: 8 }
  );
});

test("rounds to whole pixels so the window does not blur mid-drag", () => {
  assert.deepEqual(clampWindowPosition({ left: 120.6, top: 88.4, ...window232 }), { left: 121, top: 88 });
});

test("respects a caller-supplied margin", () => {
  assert.deepEqual(
    clampWindowPosition({ left: 0, top: 0, ...window232, margin: 20 }),
    { left: 20, top: 20 }
  );
});
