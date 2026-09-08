import { isChordToken, isPlainChordLine, transposeChord } from "./chord-utils.js";
import { removeUgTags, stripTabTags } from "./song-model.js";

export function renderSheet(song, transpose, replacements = new Map()) {
  const context = { next: 0, replacements };
  const fragment = document.createDocumentFragment();
  const normalized = stripTabTags(song.rawContent || "");
  const lines = normalized.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || "";
    const cleanedLine = removeUgTags(line);

    if (isPlainChordLine(cleanedLine) && nextLine.trim() && !/^\[[^\]]+\]$/.test(nextLine.trim()) && !isPlainChordLine(removeUgTags(nextLine))) {
      fragment.append(renderResponsiveChordLyricPair(cleanedLine, removeUgTags(nextLine), transpose, context));
      index += 1;
      continue;
    }

    const row = renderLine(line, transpose, context);
    fragment.append(row);
  }

  return fragment;
}

function renderLine(line, transpose, context) {
  const sectionMatch = line.trim().match(/^\[([^\]]+)\]$/);
  if (sectionMatch && !/ch\]/i.test(line)) {
    const section = document.createElement("div");
    section.className = "section-label";
    section.textContent = sectionMatch[1];
    return section;
  }

  const cleanedLine = removeUgTags(line);
  if (isPlainChordLine(cleanedLine)) {
    const chordLine = document.createElement("div");
    chordLine.className = "sheet-line plain-chord-line";
    appendChordTokens(chordLine, cleanedLine, transpose, context);
    return chordLine;
  }

  const parsed = parseChordLine(line, 0);

  if (!parsed.hasChords) {
    const wrapper = document.createElement("div");
    wrapper.className = "sheet-line";
    wrapper.textContent = parsed.lyrics;
    return wrapper;
  }

  // parseChordLine spaces chords against lyric offsets, so an intro or break made
  // up only of [ch] chords has nothing to position against and collapses into one
  // run. Keep the spacing the source line already had.
  if (!parsed.lyrics.trim()) {
    const chordLine = document.createElement("div");
    chordLine.className = "sheet-line plain-chord-line";
    appendChordTokens(chordLine, unwrapChordTags(cleanedLine), transpose, context);
    return chordLine;
  }

  return renderResponsiveChordLyricPair(parsed.chords, parsed.lyrics, transpose, context);
}

function unwrapChordTags(value) {
  return value.replace(/\[\/ch\]\[ch\]/gi, " ").replace(/\[\/?ch\]/gi, "");
}

function renderResponsiveChordLyricPair(chordLine, lyricLine, transpose, context) {
  const start = context.next;
  const wrapper = document.createElement("div");
  wrapper.className = "sheet-line chord-lyric-pair";

  const desktopChordLine = document.createElement("div");
  desktopChordLine.className = "plain-chord-line pair-desktop-chords";
  appendChordTokens(desktopChordLine, chordLine, transpose, context);
  const mobileContext = { ...context, next: start };
  wrapper.classList.toggle("is-reharmonized", [...context.replacements.keys()].some(id => id >= start && id < context.next));

  const desktopLyricLine = document.createElement("div");
  desktopLyricLine.className = "pair-desktop-lyrics";
  desktopLyricLine.textContent = lyricLine;

  const mobileLine = document.createElement("div");
  mobileLine.className = "mobile-flow-line";

  buildMobileChordLyricSegments(chordLine, lyricLine, 0).forEach((segment) => {
    const item = document.createElement("span");
    item.className = "mobile-flow-segment";

    const chord = document.createElement("span");
    chord.className = "mobile-flow-chord";
    chord.textContent = segment.chord || "\u00a0";
    if (segment.chord && isChordToken(segment.chord)) markChordToken(chord, segment.chord, transpose, mobileContext);

    const lyric = document.createElement("span");
    lyric.className = "mobile-flow-lyric";
    lyric.textContent = segment.lyric || "\u00a0";

    item.append(chord, lyric);
    mobileLine.append(item);
  });

  wrapper.append(desktopChordLine, desktopLyricLine, mobileLine);
  return wrapper;
}

/* Splits a rendered chord line into text and tappable chord spans. Whitespace is
   emitted verbatim so the monospaced alignment with the lyric line is untouched. */
function appendChordTokens(container, text, transpose, context) {
  const tokenRegex = /\S+/g;
  let cursor = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > cursor) container.append(text.slice(cursor, match.index));

    const token = match[0];
    if (isChordToken(token)) {
      const span = document.createElement("span");
      span.className = "chord-token";
      span.textContent = token;
      markChordToken(span, token, transpose, context);
      container.append(span);
    } else {
      container.append(token);
    }

    cursor = tokenRegex.lastIndex;
  }

  if (cursor < text.length) container.append(text.slice(cursor));
}

function markChordToken(element, token, transpose, context) {
  const id = context.next++;
  const changed = context.replacements.has(id);
  const replacement = changed ? preserveChordGrouping(token, context.replacements.get(id)) : token;
  const displayed = transposeChord(replacement, transpose);
  element.textContent = displayed;
  element.dataset.chordId = String(id);
  element.dataset.sourceChord = token;
  element.dataset.originalChord = transposeChord(token, transpose);
  element.classList.toggle("is-reharmonized", changed);
  element.tabIndex = 0;
  element.classList.add("chord-token");
  element.dataset.chord = displayed;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", `${displayed} chord shape${changed ? `, reharmonized from ${transposeChord(token, transpose)}` : ""}`);
}

function preserveChordGrouping(token, replacement) {
  const prefix = token.match(/^[([{]+/)?.[0] || "";
  // Only carry grouping brackets, not parentheses enclosing chord alterations.
  const withoutAlterations = token.slice(prefix.length).replace(/\([^)]*\)/g, "");
  const suffix = withoutAlterations.match(/[)\]},.;:]+$/)?.[0] || "";
  return `${prefix}${replacement}${suffix}`;
}

function buildMobileChordLyricSegments(chordLine, lyricLine, transpose) {
  // Keep bar lines, repeat counts and N.C. alongside the playable chords.
  const chordMatches = [...chordLine.matchAll(/\S+/g)];
  if (!chordMatches.length) return [{ chord: "", lyric: lyricLine.trim() }];

  const snapToWordStart = (rawPos) => {
    if (rawPos <= 0) return 0;
    let p = Math.min(rawPos, lyricLine.length);
    while (p > 0 && !/\s/.test(lyricLine[p - 1])) p -= 1;
    return p;
  };

  const positions = chordMatches.map((match) => snapToWordStart(match.index || 0));
  const segments = [];

  if (positions[0] > 0) {
    const leading = lyricLine.slice(0, positions[0]).trim();
    if (leading) segments.push({ chord: "", lyric: leading });
  }

  for (let i = 0; i < chordMatches.length; i += 1) {
    const start = positions[i];
    const end = i + 1 < chordMatches.length ? positions[i + 1] : lyricLine.length;
    const lyric = lyricLine.slice(start, end).trim();
    segments.push({
      chord: isChordToken(chordMatches[i][0]) ? transposeChord(chordMatches[i][0], transpose) : chordMatches[i][0],
      lyric
    });
  }

  return segments.filter((segment) => segment.chord || segment.lyric);
}

function parseChordLine(line, transpose) {
  let lyricPosition = 0;
  let lyrics = "";
  let chords = "";
  let hasChords = false;
  const tokenRegex = /\[ch\]([\s\S]*?)\[\/ch\]/gi;
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(line)) !== null) {
    const lyricPart = removeUgTags(line.slice(lastIndex, match.index));
    lyrics += lyricPart;
    lyricPosition += lyricPart.length;

    const chord = transposeChord(match[1], transpose);
    if (hasChords && chords.length >= lyricPosition) {
      const gap = " ".repeat(chords.length - lyricPosition + 1);
      lyrics += gap;
      lyricPosition += gap.length;
    }
    chords = padEnd(chords, lyricPosition);
    chords += chord;
    hasChords = true;
    lastIndex = tokenRegex.lastIndex;
  }

  const trailing = removeUgTags(line.slice(lastIndex));
  lyrics += trailing;

  return { lyrics, chords, hasChords };
}

function padEnd(value, length) {
  return value.length >= length ? value : `${value}${" ".repeat(length - value.length)}`;
}


// Export drafts as ordinary chords-over-lyrics text, spacing both rows together
// so a long extension cannot move the next chord away from its lyric.
export function renderedSheetText(song, transpose = 0, replacements = new Map()) {
  const fragment = renderSheet(song, transpose, replacements);
  return [...fragment.children].map(row => {
    if (row.classList.contains("chord-lyric-pair")) {
      let chords = "", lyrics = "";
      row.querySelectorAll(".mobile-flow-segment").forEach(segment => {
        const chord = segment.querySelector(".mobile-flow-chord").textContent.trim();
        const lyric = segment.querySelector(".mobile-flow-lyric").textContent.trim();
        const width = Math.max(chord.length, lyric.length) + 1;
        chords += chord.padEnd(width); lyrics += lyric.padEnd(width);
      });
      return `${chords.trimEnd()}\n${lyrics.trimEnd()}`;
    }
    if (row.classList.contains("section-label")) return `[${row.textContent}]`;
    return row.textContent;
  }).join("\n");
}
