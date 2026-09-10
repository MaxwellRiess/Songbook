/* Runs before first paint, independently of database loading or network access.

   A custom colour choice is stored already derived, as a token map per mode, so
   this script only has to set custom properties. The colour maths lives in
   palette.js and runs when the choice changes, not on every load. */
(function () {
  const MODE_KEY = "songbook.mode";
  const LEGACY_THEME_KEY = "songbook.theme";
  const TINT_KEY = "songbook.tint";
  const TINT_VERSION = 1;
  const DEFAULT_THEME_COLOR = { light: "#e1e6dc", dark: "#19211c" };

  let tint = readTint();
  let applied = [];

  function readMode() {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "light" || saved === "dark") return saved;
      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      if (legacy !== null) return legacy === "stage" ? "dark" : "light";
    } catch {
      // Appearance still works when browser storage is unavailable.
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function readTint() {
    try {
      const saved = JSON.parse(localStorage.getItem(TINT_KEY) || "null");
      if (saved && saved.version === TINT_VERSION && saved.light && saved.dark) return saved;
    } catch {
      // An unreadable or outdated choice falls back to the theme's own colours.
    }
    return null;
  }

  /* Clears the properties the last tint set before writing the new ones, so
     resetting hands the tokens back to the stylesheet. Returns the background
     the browser chrome should match. */
  function paintTint(mode) {
    const root = document.documentElement;
    for (const name of applied) root.style.removeProperty(name);
    applied = [];
    if (!tint) return null;
    for (const [name, value] of Object.entries(tint[mode] || {})) {
      root.style.setProperty(name, value);
      applied.push(name);
    }
    return tint[mode]?.["--bg"] || null;
  }

  function apply(value, persist = true) {
    const mode = value === "dark" ? "dark" : "light";
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.tint = tint ? "custom" : "default";
    const background = paintTint(mode);
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", background || DEFAULT_THEME_COLOR[mode]);
    if (persist) {
      try {
        localStorage.setItem(MODE_KEY, mode);
        localStorage.removeItem(LEGACY_THEME_KEY);
      } catch {
        // Keep the user's choice for this session if it cannot be saved.
      }
    }
  }

  /* Pass a tint from palette.js deriveTint(), or null to go back to Pebble. */
  function setTint(next, persist = true) {
    tint = next && next.version === TINT_VERSION && next.light && next.dark ? next : null;
    if (persist) {
      try {
        if (tint) localStorage.setItem(TINT_KEY, JSON.stringify(tint));
        else localStorage.removeItem(TINT_KEY);
      } catch {
        // Keep the choice for this session if it cannot be saved.
      }
    }
    apply(document.documentElement.dataset.mode, false);
  }

  window.SongbookAppearance = Object.freeze({
    apply,
    setTint,
    choice: () => (tint ? { main: tint.main, accent: tint.accent } : null)
  });

  apply(readMode(), false);
})();
