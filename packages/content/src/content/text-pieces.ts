export const textPieceCodeUnits = 262_144;

const lastOfOneCodeUnit = 0xff_ff;

function splitsACharacter(text: string, end: number): boolean {
  return end < text.length && Number(text.codePointAt(end - 1)) > lastOfOneCodeUnit;
}

function pieceEnd(text: string, start: number, codeUnits: number): number {
  const end = Math.min(text.length, start + codeUnits);
  if (!splitsACharacter(text, end)) {
    return end;
  }
  return end - start > 1 ? end - 1 : end + 1;
}

export function* textPieces(text: string, codeUnits = textPieceCodeUnits): Generator<string, void> {
  let start = 0;
  while (start < text.length) {
    const end = pieceEnd(text, start, codeUnits);
    yield text.slice(start, end);
    start = end;
  }
}
