(() => {
  // GuitarTuna lays a song out as a beat grid: every lyric line is a row of beat
  // cells, each carrying a `--w` custom property for the number of lyric
  // characters it spans, and a chord hangs off the cell it starts on. Adding up
  // the widths of the cells before a chord gives the text column that chord sits
  // above, which is all a plain chords-over-lyrics sheet needs.
  function buildChordSheet(blocks) {
    const lines = [];

    for (const block of blocks || []) {
      if (block.type === "section") {
        if (lines.length && lines[lines.length - 1] !== "") lines.push("");
        if (block.label) lines.push(`[${block.label}]`);
        continue;
      }

      const chordLine = buildChordLine(block.chords);
      const lyric = String(block.lyric || "").replace(/\s+$/, "");

      if (chordLine) lines.push(chordLine);
      if (lyric) lines.push(lyric);
      if (!chordLine && !lyric && lines.length && lines[lines.length - 1] !== "") lines.push("");
    }

    // Trimming whitespace here would eat the indent of a sheet whose first chord
    // lands mid-line, so only blank lines are dropped from the ends.
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

    return lines.join("\n");
  }

  function buildChordLine(chords) {
    let line = "";

    for (const entry of chords || []) {
      const chord = String(entry?.chord || "").trim();
      if (!chord) continue;

      // Two chords on the same beat still need a gap between them.
      const start = Math.max(Number(entry.column) || 0, line ? line.length + 1 : 0);
      line = line.padEnd(start, " ") + chord;
    }

    return line;
  }

  function readBlocks(root) {
    return [...root.querySelectorAll(".partContainer, .line")].map((node) => (
      node.classList.contains("partContainer")
        ? { type: "section", label: (node.querySelector(".part_type")?.textContent || "").trim() }
        : { type: "line", lyric: readLyric(node), chords: readChords(node) }
    ));
  }

  function readChords(line) {
    const chords = [];
    let column = 0;

    for (const beat of line.querySelectorAll(".beat_info")) {
      const chordElement = beat.querySelector("[data-chord]");
      const chord = (chordElement?.getAttribute("data-chord") || chordElement?.textContent || "").trim();
      if (chord) chords.push({ column, chord });
      column += Number(beat.style.getPropertyValue("--w")) || 0;
    }

    return chords;
  }

  function readLyric(line) {
    return [...line.children]
      .filter((child) => child.tagName === "DIV" && !child.classList.contains("beat_info"))
      .map((child) => child.textContent || "")
      .join("");
  }

  function findSheetRoot(doc) {
    return doc.querySelector('#songcontent, [data-testid="song-lyrics"], .lyrics-root');
  }

  function extractSong(doc) {
    const root = findSheetRoot(doc);
    if (!root) throw new Error("No GuitarTuna chord sheet was found on this page.");

    const rawContent = buildChordSheet(readBlocks(root));
    if (!rawContent) throw new Error("The GuitarTuna chord sheet on this page is empty.");

    const meta = readMeta(doc);

    return {
      title: meta.title || "Untitled song",
      artist: meta.artist || "Unknown artist",
      key: meta.key,
      capo: meta.capo,
      tuning: meta.tuning,
      tags: ["clipped", "guitartuna"],
      sourceUrl: doc.location?.href || "",
      rawContent
    };
  }

  // GuitarTuna publishes the song details as schema.org MusicComposition, with
  // tuning, capo and tempo packed into one `text` string.
  function readMeta(doc) {
    const meta = { title: "", artist: "", key: "", capo: "", tuning: "" };

    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed = null;
      try {
        parsed = JSON.parse(script.textContent || "");
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      if (![parsed["@type"]].flat().includes("MusicComposition")) continue;

      meta.title = meta.title || stripFormatSuffix(parsed.name);
      meta.artist = meta.artist || String([parsed.composer].flat()[0]?.name || "").trim();
      meta.key = meta.key || normalizeKey(parsed.musicalKey);

      const text = String(parsed.text || "");
      meta.tuning = meta.tuning || (text.match(/Tuning:\s*(.+?)(?=\s+(?:Key|Capo|Tempo):|$)/i)?.[1] || "").trim();
      meta.capo = meta.capo || (text.match(/Capo:\s*(\d+)/i)?.[1] || "");
    }

    // e.g. "LITTLE MUSGRAVE chords by James Yorkston, The Big Eyes Family Players"
    const heading = (doc.querySelector("h1")?.textContent || "").trim().replace(/\s+/g, " ");
    const headingMatch = heading.match(/^(.*?)\s+(?:chords|tabs?)\s+by\s+(.*)$/i);
    if (headingMatch) {
      meta.title = meta.title || headingMatch[1].trim();
      meta.artist = meta.artist || headingMatch[2].trim();
    }

    return meta;
  }

  function stripFormatSuffix(value) {
    return String(value || "").replace(/\s*\((?:chords|tabs?)\)\s*$/i, "").trim();
  }

  // "A minor" reads as a sentence next to the "Am" and "Db" keys other sources give.
  function normalizeKey(value) {
    const text = String(value || "").trim();
    const match = text.match(/^([A-G][#b]?)\s*(minor|major|min|maj|m)?$/i);
    if (!match) return text;
    const quality = match[2] || "";
    return /^m/i.test(quality) && !/^maj/i.test(quality) ? `${match[1]}m` : match[1];
  }

  globalThis.songbookGuitarTuna = { buildChordSheet, readBlocks, extractSong };
})();
