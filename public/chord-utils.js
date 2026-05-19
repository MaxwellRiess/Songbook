const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#"
};

const CHORD_TOKEN_PATTERN = /^[A-G](?:#|b)?(?:(?:[Mm]aj|[Mm]in|[Dd]im|[Aa]ug|[Ss]us|[Aa]dd|[Nn]o|m|M)?[0-9#b+\-()]*)*(?:\/[A-G](?:#|b)?)?$/;

export function transposeChord(chord, steps) {
  if (!steps) return chord;

  return chord.replace(/(^|[^A-Ga-g#b])([A-G])([#b]?)(?=(?:[Mm]aj|[Mm]in|[Dd]im|[Aa]ug|[Ss]us|[Aa]dd|[Nn]o|m|M|[0-9()/+\-]|$))/g, (full, prefix, note, accidental) => {
    const normalized = `${note.toUpperCase()}${accidental || ""}`;
    const sharpNote = FLAT_TO_SHARP[normalized] || normalized;
    const index = NOTES_SHARP.indexOf(sharpNote);
    if (index === -1) return full;
    const next = NOTES_SHARP[(index + steps + 120) % 12];
    return `${prefix}${next}`;
  });
}

export function transposeChordLine(line, steps) {
  if (!steps) return line;
  return line.replace(/\S+/g, (token) => (isChordToken(token) ? transposeChord(token, steps) : token));
}

export function isPlainChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;

  const musicalTokens = tokens.filter((token) => !isBarToken(token) && !isChordLineDecoration(token));
  if (!musicalTokens.length) return false;

  const chordTokens = musicalTokens.filter(isChordToken);
  return chordTokens.length === musicalTokens.length && (chordTokens.length > 1 || line.trim().length <= 8);
}

export function isChordToken(token) {
  const normalized = normalizeChordToken(token);
  return CHORD_TOKEN_PATTERN.test(normalized);
}

function normalizeChordToken(token) {
  return token
    .replace(/^[([{]+/g, "")
    .replace(/[)\]}]+$/g, "")
    .replace(/[.,;:]+$/g, "");
}

function isChordLineDecoration(token) {
  return /^[^A-Za-z0-9]+$/.test(token);
}

function isBarToken(token) {
  return /^[|:]+$/.test(token) || /^\(?x\d+\)?$/i.test(token) || /^\(?\d+x\)?$/i.test(token) || /^N\.?C\.?$/i.test(token);
}
