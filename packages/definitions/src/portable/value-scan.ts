import { createHash } from 'node:crypto';

import { blankSpansIn, lineAt, type BlankSpan } from './blanks.ts';
import type { PortableText, TextPlace } from './package-texts.ts';
import { hostOf, matchedIn, valueMatchesIn, type ValueClass, type ValueMatch } from './value-classes.ts';

export interface Occurrence extends TextPlace {
  readonly line: number;
}

export interface Finding {
  readonly id: string;
  readonly class: ValueClass;
  readonly value: string;
  readonly occurrences: readonly Occurrence[];
}

export function findingId(valueClass: ValueClass, value: string): string {
  return createHash('sha256').update(`${valueClass}\n${value}`).digest('hex').slice(0, 32);
}

export interface Span {
  readonly from: number;
  readonly to: number;
}

export interface ScanForm {
  readonly text: string;
  readonly places: readonly Span[];
}

const unseenCharacter = /^[\p{Cf}\p{Default_Ignorable_Code_Point}]$/u;

const escaped =
  /\\u\{([0-9A-Fa-f]{1,6})\}|\\u([0-9A-Fa-f]{4})|\\x([0-9A-Fa-f]{2})|&#[xX]([0-9A-Fa-f]{1,6});|&#([0-9]{1,7});|&([A-Za-z]+);|%([0-9A-Fa-f]{2})/gu;

const namedCharacters: ReadonlyMap<string, string> = new Map([
  ['commat', '@'],
  ['period', '.'],
  ['lowbar', '_'],
  ['hyphen', '-'],
  ['colon', ':'],
  ['sol', '/'],
  ['num', '#'],
  ['plus', '+'],
  ['equals', '='],
  ['quest', '?'],
]);

const keptAsWritten = /^[\p{Cc}\p{Cs}\p{White_Space}]$/u;

const percentDecoded = /^[A-Za-z0-9@._~+-]$/u;

const HIGHEST_CODE_POINT = 0x10_ff_ff;

function characterOf(point: number): string | undefined {
  if (point > HIGHEST_CODE_POINT) return undefined;
  const character = String.fromCodePoint(point);
  return keptAsWritten.test(character) ? undefined : character;
}

function decodedOf(groups: readonly string[]): string | undefined {
  const named = String(groups[6]);
  if (named !== '') return namedCharacters.get(named);
  const decimal = String(groups[5]);
  if (decimal !== '') return characterOf(Number(decimal));
  const percent = String(groups[7]);
  const character = characterOf(Number.parseInt(groups.slice(1, 5).join('') + percent, 16));
  return percent === '' || percentDecoded.test(String(character)) ? character : undefined;
}

interface Piece {
  readonly point: string;
  readonly from: number;
  readonly to: number;
}

function piecesOf(written: string): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  const plainUntil = (end: number): void => {
    for (const point of written.slice(at, end)) {
      pieces.push({ point, from: at, to: at + point.length });
      at += point.length;
    }
  };
  for (const { text, groups, at: start } of matchedIn(written, escaped)) {
    const decoded = decodedOf(groups);
    if (decoded === undefined) continue;
    plainUntil(start);
    pieces.push({ point: decoded, from: start, to: start + text.length });
    at = start + text.length;
  }
  plainUntil(written.length);
  return pieces;
}

export function scanFormOf(written: string): ScanForm {
  let text = '';
  const places: Span[] = [];
  for (const { point, from, to } of piecesOf(written)) {
    const plain = unseenCharacter.test(point) ? '' : point.normalize('NFKC');
    text += plain;
    places.push(...Array.from({ length: plain.length }, () => ({ from, to })));
  }
  return { text, places };
}

export function writtenSpanOf({ places }: ScanForm, { from, to }: Span): Span {
  const covered = places.slice(from, to);
  return {
    from: covered.reduce((least, place) => Math.min(least, place.from), Number.POSITIVE_INFINITY),
    to: covered.reduce((most, place) => Math.max(most, place.to), Number.NEGATIVE_INFINITY),
  };
}

const blankHost = /(?:^|\.)[A-Za-z][A-Za-z0-9_]{1,39}\.blank\.invalid$/iu;

function standsForABlank(match: ValueMatch, spans: readonly BlankSpan[]): boolean {
  if (spans.some(({ from, to }) => from <= match.from && match.to <= to)) return true;
  return match.class === 'address' && blankHost.test(hostOf(match.value));
}

export function standingMatchesIn(text: string): ValueMatch[] {
  const blanks = blankSpansIn(text);
  return valueMatchesIn(text).filter((match) => match.class === 'secret' || !standsForABlank(match, blanks));
}

interface Gathered {
  readonly class: ValueClass;
  readonly value: string;
  readonly occurrences: readonly Occurrence[];
}

export function findingsIn(texts: readonly PortableText[]): Finding[] {
  const found = new Map<string, Gathered>();
  for (const { text: written, ...place } of texts) {
    const { text } = scanFormOf(written);
    for (const match of standingMatchesIn(text)) {
      const id = findingId(match.class, match.value);
      const finding = found.get(id) ?? { class: match.class, value: match.value, occurrences: [] };
      const occurrence = { ...place, line: lineAt(text, match.from) };
      const known = finding.occurrences.some((seen: Occurrence) => JSON.stringify(seen) === JSON.stringify(occurrence));
      found.set(id, known ? finding : { ...finding, occurrences: [...finding.occurrences, occurrence] });
    }
  }
  return Array.from(found, ([id, finding]: readonly [string, Gathered]) => ({
    id,
    class: finding.class,
    value: finding.value,
    occurrences: finding.occurrences,
  }));
}
