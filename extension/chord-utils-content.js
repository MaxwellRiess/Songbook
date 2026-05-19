(() => {
  const CHORD_TOKEN_PATTERN = /^[A-G](?:#|b)?(?:(?:[Mm]aj|[Mm]in|[Dd]im|[Aa]ug|[Ss]us|[Aa]dd|[Nn]o|m|M)?[0-9#b+\-()]*)*(?:\/[A-G](?:#|b)?)?$/;

  function isPlainChordLine(line) {
    const tokens = String(line).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;

    const musicalTokens = tokens.filter((token) => !isBarToken(token) && !isChordLineDecoration(token));
    if (!musicalTokens.length) return false;

    const chordTokens = musicalTokens.filter(isChordToken);
    return chordTokens.length === musicalTokens.length && (chordTokens.length > 1 || line.trim().length <= 8);
  }

  function isChordToken(token) {
    const normalized = String(token)
      .replace(/^[([{]+/g, "")
      .replace(/[)\]}]+$/g, "")
      .replace(/[.,;:]+$/g, "");
    return CHORD_TOKEN_PATTERN.test(normalized);
  }

  function isChordLineDecoration(token) {
    return /^[^A-Za-z0-9]+$/.test(token);
  }

  function isBarToken(token) {
    return /^[|:]+$/.test(token) || /^\(?x\d+\)?$/i.test(token) || /^\(?\d+x\)?$/i.test(token) || /^N\.?C\.?$/i.test(token);
  }

  globalThis.songbookChordUtils = { isPlainChordLine, isChordToken };
})();

