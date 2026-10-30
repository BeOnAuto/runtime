const measures = [
  'ms',
  's',
  'm',
  'h',
  'd',
  '%',
  'KiB',
  'MiB',
  'GiB',
  'bytes',
  'rows',
  'events',
  'series',
  'periods',
  'tokens',
  'times',
];

function escaped(unit: string): string {
  return unit.replaceAll(/[$()*+./?[\\\]^{|}]/gu, String.raw`\$&`);
}

function statusCodeOf(units: readonly string[]): RegExp {
  const measured = [...measures, ...units.map((unit) => escaped(unit))].join('|');
  return new RegExp(
    String.raw`(?<![\d,])(?<!\d\.)\b[1-5]\d{2}\b(?!\.\d|[\d,]|(?:\sto\s[\d.,]+)?\s?(?:${measured})(?![\p{L}\p{N}_]))`,
    'u',
  );
}

const namedTerms: readonly RegExp[] = [
  /\bspecs?\b/iu,
  /\bprimitives?\b/iu,
  /\bexecutions?\b/iu,
  /\binference\b/iu,
  /\borchestration\b/iu,
  /\brecollection\b/iu,
  /\bya?ml\b/iu,
  /\bjson\b/iu,
  /\bliquid\b/iu,
  /\bjq\b/iu,
  /\bschemas?\b/iu,
  /\bfront matter\b/iu,
  /\benums?\b/iu,
  /\bidempotent\b/iu,
];

const shapedTerms: readonly RegExp[] = [
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/u,
  /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/iu,
  /\S\/\S/u,
];

export const internalTerms: readonly RegExp[] = [...namedTerms, statusCodeOf([]), ...shapedTerms];

export function internalTermsIn(text: string, measuredIn: readonly string[] = []): readonly string[] {
  const found: string[] = [];
  for (const term of [...namedTerms, statusCodeOf(measuredIn), ...shapedTerms]) {
    const match = term.exec(text);
    if (match !== null) {
      found.push(match[0]);
    }
  }
  return found;
}
