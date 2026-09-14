(() => {
  // The tail of the built iPhone snippet. iOS has no way to run a Chrome
  // extension, so the Shortcuts action "Run JavaScript on Web Page" plays the
  // part the popup plays on a desktop: it runs the readers above against the
  // Safari page and hands back a Songbook URL for the Shortcut to open. The app
  // decodes the #import= payload on load, saves it and syncs it.
  //
  // Change this to http://127.0.0.1:3000 to clip into a local development copy.
  const SONGBOOK_URL = "https://maxwellriess.github.io/Songbook";

  // Safari carries far longer URLs than this, but a sheet that overruns should
  // say so rather than arrive silently truncated and half-imported.
  const MAX_URL_LENGTH = 60000;

  // Defined by the Shortcuts action. Absent when the extension injects these
  // same files, which is why this tail does nothing there.
  if (typeof completion !== "function") return;

  Promise.resolve()
    .then(() => globalThis.songbookClipper.extractSong(document))
    .then((song) => {
      const url = `${SONGBOOK_URL.replace(/\/+$/, "")}/#import=${encodeBase64Url(JSON.stringify(song))}`;
      if (url.length > MAX_URL_LENGTH) {
        throw new Error("This chord sheet is too long to pass through a URL. Clip it with the browser extension instead.");
      }
      completion({ url, title: song.title || "", artist: song.artist || "" });
    })
    .catch((error) => completion({ error: error?.message || "Clip failed." }));

  // The app decodes with atob over the same base64url alphabet, so the padding
  // and the two substituted characters have to match what it expects.
  function encodeBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
})();
