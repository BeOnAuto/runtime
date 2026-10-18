import type { LineOfOffset } from '../template/engine-failure.ts';
import {
  asWritten,
  loopOf,
  phrasesOf,
  trimmed,
  writtenOf,
  type Piece,
  type ReadPiece,
  type TagPiece,
} from './liquid-phrases.ts';
import { escapedInline } from './markdown-text.ts';
import type { Phrases } from './overview.ts';

interface Matched {
  readonly at: number;
  readonly opening: TagPiece;
  readonly closing: TagPiece;
  readonly end: number;
}

interface Opened {
  readonly at: number;
  readonly opening: TagPiece;
}

interface Construct {
  readonly opening: TagPiece;
  readonly inner: readonly Piece[];
  readonly closing: TagPiece;
}

interface Branch {
  readonly opening: TagPiece;
  readonly pieces: readonly Piece[];
}

interface Branches {
  readonly first: readonly Piece[];
  readonly alternatives: readonly Branch[];
}

interface Separator {
  readonly opening: TagPiece;
  readonly closing: TagPiece;
  readonly written: string;
}

interface Separated {
  readonly items: readonly Piece[];
  readonly separator: Separator | undefined;
}

interface Reading {
  readonly phrases: Phrases;
  readonly after: number;
}

interface Marked {
  readonly phrases: Phrases;
  readonly mark: string;
}

const blocks: ReadonlySet<string> = new Set(['if', 'unless', 'for', 'case']);

const notLast: ReadonlySet<string> = new Set([
  'unless forloop.last',
  'if forloop.last == false',
  'if forloop.index < forloop.length',
]);

const endMark = /[.!?]+(?=["'”’)\]]*$)/u;

const separatorWords: ReadonlyMap<string, string> = new Map([
  [', ', 'commas'],
  ['; ', 'semicolons'],
  [' and ', 'and'],
  [' / ', 'slashes'],
  ['\n', 'a line each'],
]);

function matchedBlocks(pieces: readonly Piece[]): ReadonlyMap<number, Matched> {
  const matched = new Map<number, Matched>();
  const open: Opened[] = [];
  for (const [index, piece] of pieces.entries()) {
    const innermost = open.at(-1);
    if (piece.kind === 'tag' && blocks.has(piece.name)) {
      open.push({ at: index, opening: piece });
    } else if (piece.kind === 'tag' && innermost !== undefined && piece.name === `end${innermost.opening.name}`) {
      matched.set(innermost.at, { ...innermost, closing: piece, end: index });
      open.pop();
    }
  }
  return matched;
}

function nestedIndices(pieces: readonly Piece[]): ReadonlySet<number> {
  const nested = new Set<number>();
  for (const { at, end } of matchedBlocks(pieces).values()) {
    for (let index = at + 1; index < end; index += 1) {
      nested.add(index);
    }
  }
  return nested;
}

function branchesOf(inner: readonly Piece[], splitters: readonly string[]): Branches {
  const nested = nestedIndices(inner);
  const first: Piece[] = [];
  const alternatives: Branch[] = [];
  let current = first;
  for (const [index, piece] of inner.entries()) {
    if (piece.kind === 'tag' && splitters.includes(piece.name) && !nested.has(index)) {
      current = [];
      alternatives.push({ opening: piece, pieces: current });
    } else {
      current.push(piece);
    }
  }
  return { first, alternatives };
}

function separatedOf(pieces: readonly Piece[]): Separated {
  const last = pieces.length - 1;
  const trailing = [...matchedBlocks(pieces).values()].find(({ end }) => end === last);
  if (trailing === undefined) {
    return { items: pieces, separator: undefined };
  }
  const { at, opening, closing } = trailing;
  const body = pieces.slice(at + 1, last);
  const separates =
    notLast.has(`${opening.name} ${asWritten(opening.args)}`) && body.every((piece) => piece.kind !== 'tag');
  return separates
    ? {
        items: pieces.slice(0, at),
        separator: { opening, closing, written: body.map((piece) => writtenOf(piece)).join('') },
      }
    : { items: pieces, separator: undefined };
}

function separatorPhrases(separator: Separator | undefined): Phrases {
  const written = separator?.written ?? '';
  const words = separatorWords.get(written);
  if (words !== undefined) {
    return [`, separated by ${words}`];
  }
  const quoted = written.trim();
  return quoted === '' ? [] : [', separated by ', { code: quoted }];
}

function startSpace(piece: Piece | undefined): string {
  const text = piece?.kind === 'text' ? piece.text : '';
  return text.slice(0, text.length - text.trimStart().length);
}

function endSpace(piece: Piece | undefined): string {
  const text = piece?.kind === 'text' ? piece.text : '';
  return text.slice(text.trimEnd().length);
}

function saidOf(pieces: readonly Piece[], lineOf: LineOfOffset): Phrases {
  return trimmed(withInlineConstructs(pieces, lineOf).flatMap((piece) => phrasesOf(piece)));
}

function shownOf(said: Phrases): Phrases {
  return said.length > 0 ? said : ['nothing'];
}

function markedOf(said: Phrases): Marked {
  const last = said.at(-1);
  const found = typeof last === 'string' ? endMark.exec(last) : null;
  if (found === null) {
    return { phrases: said, mark: '' };
  }
  const { input, index } = found;
  const [mark] = found;
  const kept = trimmed([...said.slice(0, -1), `${input.slice(0, index)}${input.slice(index + mark.length)}`]);
  return kept.length > 0 ? { phrases: kept, mark } : { phrases: said, mark: '' };
}

function conditionOf({ args }: TagPiece): string {
  return escapedInline(asWritten(args));
}

function branchWords(opening: TagPiece, said: Phrases): Phrases {
  switch (opening.name) {
    case 'if':
    case 'elsif': {
      return [...said, ` when ${conditionOf(opening)}`];
    }
    case 'unless': {
      return [...said, ` unless ${conditionOf(opening)}`];
    }
    default: {
      return ['otherwise ', ...said];
    }
  }
}

function branchPhrases({ opening, pieces }: Branch, lineOf: LineOfOffset): Phrases {
  return branchWords(opening, shownOf(saidOf(pieces, lineOf)));
}

function markedBranch({ opening, pieces }: Branch, lineOf: LineOfOffset): Marked {
  const { phrases, mark } = markedOf(saidOf(pieces, lineOf));
  return { phrases: branchWords(opening, shownOf(phrases)), mark };
}

function joinedByCommas(readings: readonly Phrases[]): Phrases {
  return readings.flatMap((reading, index) => (index > 0 ? [', ', ...reading] : reading));
}

function spacedAround(inner: readonly Piece[], phrases: Phrases): Phrases {
  return [startSpace(inner.at(0)), ...phrases, endSpace(inner.at(-1))];
}

function breaksBetween(lineOf: LineOfOffset, from: number, to: number): number {
  return lineOf(to) - lineOf(from);
}

function loopPhrases({ opening, inner, closing }: Construct, lineOf: LineOfOffset): Phrases | undefined {
  const loop = loopOf(opening.args);
  const { first, alternatives } = branchesOf(inner, ['else']);
  const { items, separator } = separatedOf(first);
  const separatorBreaks =
    separator === undefined ? 0 : breaksBetween(lineOf, separator.opening.end, separator.closing.begin);
  if (loop === undefined || breaksBetween(lineOf, opening.begin, closing.end) !== separatorBreaks) {
    return undefined;
  }
  const each = [
    `each ${escapedInline(loop.item)} of ${escapedInline(loop.list)} as `,
    ...shownOf(saidOf(items, lineOf)),
    ...separatorPhrases(separator),
  ];
  return spacedAround(inner, joinedByCommas([each, ...alternatives.map((branch) => branchPhrases(branch, lineOf))]));
}

function conditionPhrases({ opening, inner, closing }: Construct, lineOf: LineOfOffset): Phrases | undefined {
  if (breaksBetween(lineOf, opening.begin, closing.end) > 0) {
    return undefined;
  }
  const { first, alternatives } = branchesOf(inner, ['elsif', 'else']);
  const readings = [{ opening, pieces: first }, ...alternatives].map((branch) => markedBranch(branch, lineOf));
  const mark = readings.findLast((reading) => reading.mark !== '')?.mark ?? '';
  return spacedAround(inner, [...joinedByCommas(readings.map((reading) => reading.phrases)), mark]);
}

function constructPhrases(construct: Construct, lineOf: LineOfOffset): Phrases | undefined {
  if (construct.opening.name === 'case') {
    return undefined;
  }
  return construct.opening.name === 'for' ? loopPhrases(construct, lineOf) : conditionPhrases(construct, lineOf);
}

function readingAt(
  pieces: readonly Piece[],
  index: number,
  matched: ReadonlyMap<number, Matched>,
  lineOf: LineOfOffset,
): Reading | undefined {
  const block = matched.get(index);
  if (block === undefined) {
    return undefined;
  }
  const { opening, closing, end } = block;
  const phrases = constructPhrases({ opening, inner: pieces.slice(index + 1, end), closing }, lineOf);
  return phrases === undefined ? undefined : { phrases, after: end + 1 };
}

export function withInlineConstructs(pieces: readonly Piece[], lineOf: LineOfOffset): readonly ReadPiece[] {
  const matched = matchedBlocks(pieces);
  const read: ReadPiece[] = [];
  let after = 0;
  for (const [index, piece] of pieces.entries()) {
    if (index >= after) {
      const reading = readingAt(pieces, index, matched, lineOf);
      read.push(reading === undefined ? piece : { kind: 'inline', phrases: reading.phrases });
      after = reading?.after ?? index + 1;
    }
  }
  return read;
}
