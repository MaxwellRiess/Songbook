import { isChordToken, isPlainChordLine, transposeChord, transposeChordLine } from "./chord-utils.js";
import { removeUgTags, stripTabTags } from "./song-model.js";

export function renderSheet(song, transpose) {
  const fragment = document.createDocumentFragment();
  const normalized = stripTabTags(song.rawContent || "");
  const lines = normalized.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || "";
    const cleanedLine = removeUgTags(line);

    if (isPlainChordLine(cleanedLine) && nextLine.trim() && !isPlainChordLine(removeUgTags(nextLine))) {
      fragment.append(renderResponsiveChordLyricPair(cleanedLine, removeUgTags(nextLine), transpose));
      index += 1;
      continue;
    }

    const row = renderLine(line, transpose);
    fragment.append(row);
  }

  return fragment;
}

function renderLine(line, transpose) {
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
    appendChordTokens(chordLine, transposeChordLine(cleanedLine, transpose));
    return chordLine;
  }

  const parsed = parseChordLine(line, 0);

  if (!parsed.hasChords) {
    const wrapper = document.createElement("div");
    wrapper.className = "sheet-line";
    wrapper.textContent = parsed.lyrics;
    return wrapper;
  }

  return renderResponsiveChordLyricPair(parsed.chords, parsed.lyrics, transpose);
}

function renderResponsiveChordLyricPair(chordLine, lyricLine, transpose) {
  const wrapper = document.createElement("div");
  wrapper.className = "sheet-line chord-lyric-pair";

  const desktopChordLine = document.createElement("div");
  desktopChordLine.className = "plain-chord-line pair-desktop-chords";
  appendChordTokens(desktopChordLine, transposeChordLine(chordLine, transpose));

  const desktopLyricLine = document.createElement("div");
  desktopLyricLine.className = "pair-desktop-lyrics";
  desktopLyricLine.textContent = lyricLine;

  const mobileLine = document.createElement("div");
  mobileLine.className = "mobile-flow-line";

  buildMobileChordLyricSegments(chordLine, lyricLine, transpose).forEach((segment) => {
    const item = document.createElement("span");
    item.className = "mobile-flow-segment";

    const chord = document.createElement("span");
    chord.className = "mobile-flow-chord";
    chord.textContent = segment.chord || "\u00a0";
    if (segment.chord) markChordToken(chord, segment.chord);

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
function appendChordTokens(container, text) {
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
      markChordToken(span, token);
      container.append(span);
    } else {
      container.append(token);
    }

    cursor = tokenRegex.lastIndex;
  }

  if (cursor < text.length) container.append(text.slice(cursor));
}

function markChordToken(element, token) {
  element.classList.add("chord-token");
  element.dataset.chord = token;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", `${token} chord shape`);
}

function buildMobileChordLyricSegments(chordLine, lyricLine, transpose) {
  const chordMatches = [...chordLine.matchAll(/\S+/g)].filter((match) => isChordToken(match[0]));
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
      chord: transposeChord(chordMatches[i][0], transpose),
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

