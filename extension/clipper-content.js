(() => {
  // The single entry point both front ends use: the extension injects these
  // readers into the tab and calls this, and the iPhone Shortcut runs the same
  // files as one pasted snippet. Keeping the dispatch here means neither front
  // end carries its own idea of which reader a page needs.
  const READERS = {
    "ultimate-guitar": () => globalThis.songbookUltimateGuitar,
    guitartuna: () => globalThis.songbookGuitarTuna
  };

  const NO_PAGE_MESSAGE = "Open a loaded Ultimate Guitar or GuitarTuna chord page first.";

  async function extractSong(doc = document) {
    const source = detectSource(doc?.location?.href || "");
    if (!source) throw new Error(NO_PAGE_MESSAGE);

    const reader = READERS[source]();
    if (!reader?.extractSong) throw new Error(`Songbook ${source} reader did not load.`);

    return reader.extractSong(doc);
  }

  function detectSource(value) {
    try {
      const { hostname } = new URL(value);
      if (matchesHost(hostname, "ultimate-guitar.com")) return "ultimate-guitar";
      if (matchesHost(hostname, "guitartuna.com")) return "guitartuna";
      return "";
    } catch {
      return "";
    }
  }

  function matchesHost(hostname, domain) {
    const host = hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  }

  globalThis.songbookClipper = { detectSource, extractSong, NO_PAGE_MESSAGE };
})();
