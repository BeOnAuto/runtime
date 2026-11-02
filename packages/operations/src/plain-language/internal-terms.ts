const statusCodeOutsideAMeasure =
  /(?<![\d,])(?<!\d\.)\b[1-5]\d{2}\b(?!\.\d|[\d,]|(?:\sto\s[\d.,]+)?\s?(?:ms|s|m|h|d|%|KiB|MiB|GiB|bytes|rows|events|series|periods|tokens|times)(?![\p{L}\p{N}_]))/u;

const statusCodesOutsideAMeasure = new RegExp(statusCodeOutsideAMeasure, 'gu');

const rangeBeforeAUnit = /^\sto\s[\d.,]+\s?/u;

const spaceBeforeAUnit = /^\s/u;

const partOfAWord = /^[\p{L}\p{N}_]/u;

function textsAfterTheNumberOf(after: string): readonly string[] {
  return [after, after.replace(spaceBeforeAUnit, ''), after.replace(rangeBeforeAUnit, '')];
}

function startsWithTheUnit(text: string, unit: string): boolean {
  return text.startsWith(unit) && !partOfAWord.test(text.slice(unit.length));
}

function isMeasuredIn(units: readonly string[], after: string): boolean {
  return textsAfterTheNumberOf(after).some((text) => units.some((unit) => startsWithTheUnit(text, unit)));
}

function statusCodesIn(text: string, units: readonly string[]): readonly string[] {
  for (const { 0: digits, index } of text.matchAll(statusCodesOutsideAMeasure)) {
    if (!isMeasuredIn(units, text.slice(index + digits.length))) {
      return [digits];
    }
  }
  return [];
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

export const internalTerms: readonly RegExp[] = [...namedTerms, statusCodeOutsideAMeasure, ...shapedTerms];

function firstOf(text: string, term: Readonly<RegExp>): readonly string[] {
  const match = term.exec(text);
  return match === null ? [] : [match[0]];
}

export function internalTermsIn(text: string, measuredIn: readonly string[] = []): readonly string[] {
  return [
    ...namedTerms.flatMap((term: Readonly<RegExp>) => firstOf(text, term)),
    ...statusCodesIn(text, measuredIn),
    ...shapedTerms.flatMap((term: Readonly<RegExp>) => firstOf(text, term)),
  ];
}
