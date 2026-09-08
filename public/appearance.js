/* Runs before first paint, independently of database loading or network access. */
(function () {
  const MODE_KEY = "songbook.mode";
  const LEGACY_THEME_KEY = "songbook.theme";

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

  function apply(value, persist = true) {
    const mode = value === "dark" ? "dark" : "light";
    document.documentElement.dataset.mode = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#19211c" : "#e1e6dc");
    if (persist) {
      try {
        localStorage.setItem(MODE_KEY, mode);
        localStorage.removeItem(LEGACY_THEME_KEY);
      } catch {
        // Keep the user's choice for this session if it cannot be saved.
      }
    }
  }

  window.SongbookAppearance = Object.freeze({ apply });
  apply(readMode(), false);
})();
