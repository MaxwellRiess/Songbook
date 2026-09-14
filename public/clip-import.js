// A clipped song reaches the app as base64url JSON in the URL fragment. The
// browser extension writes it straight into IndexedDB, but iOS has no way to
// run an extension, so the Shortcut hands the song over as a link instead. The
// fragment never leaves the browser, which keeps the song off the network on
// the way in.
export function decodeClipPayload(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
