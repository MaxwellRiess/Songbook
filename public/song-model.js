export const HIDDEN_META_TAGS = new Set(["clip", "clipped", "ultimate-guitar", "ultimate guitar"]);

export function normalizeSong(input) {
  const timestamp = new Date().toISOString();
  return {
    id: input.id || crypto.randomUUID(),
    title: String(input.title || "Untitled song").trim(),
    artist: String(input.artist || "Unknown artist").trim(),
    key: String(input.key || "").trim(),
    capo: String(input.capo || "").trim(),
    tuning: String(input.tuning || "").trim(),
    tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [],
    sourceUrl: String(input.sourceUrl || "").trim(),
    rawContent: String(input.rawContent || "").replace(/\r\n?/g, "\n").trim(),
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
    lastOpenedAt: input.lastOpenedAt || ""
  };
}

export function stripTabTags(value) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, "    ")
    .replace(/\[\/?tab\]/gi, "");
}

export function removeUgTags(value) {
  return stripTabTags(value)
    .replace(/\[(?:\/)?(?:b|i|u)\]/gi, "")
    .replace(/\[url[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1");
}

export function toPlainChordSheet(song) {
  const header = [`${song.title} - ${song.artist}`];
  const meta = [song.key && `Key: ${song.key}`, song.capo && `Capo: ${song.capo}`, song.tuning && `Tuning: ${song.tuning}`]
    .filter(Boolean)
    .join(" | ");
  if (meta) header.push(meta);
  return `${header.join("\n")}\n\n${stripTabTags(song.rawContent || "")}`;
}

export function buildMetaPills(song) {
  const visibleTags = (song.tags || []).filter(
    (tag) => !HIDDEN_META_TAGS.has(String(tag).trim().toLowerCase())
  );
  const values = [
    song.key && `Key ${song.key}`,
    song.capo && `Capo ${song.capo}`,
    song.tuning,
    ...visibleTags
  ].filter(Boolean);

  return values.map((value) => {
    const pill = document.createElement("span");
    pill.textContent = value;
    return pill;
  });
}
