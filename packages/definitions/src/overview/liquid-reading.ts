import { Tokenizer, TypeGuards } from 'liquidjs';

import { valueMeaning } from '../overview-words/field-meanings.ts';
import { inBrackets } from '../overview-words/template-words.ts';
import { charactersIn, firstCharacters } from '../plain-language/characters.ts';
import { linesOf, type LineOfOffset } from '../template/engine-failure.ts';
import { withInlineConstructs } from './inline-constructs.ts';
import {
  blocksOf,
  boldValue,
  loopOf,
  pathIn,
  writtenOf,
  type OutputPiece,
  type Piece,
  type TextPiece,
} from './liquid-phrases.ts';
import { paragraphsAsWritten } from './markdown-text.ts';
import { paragraph, type OverviewBlock, type Paragraph, type Phrase, type Quote } from './overview.ts';
import type { JsonSchema } from './schema-reading.ts';

export const mostReadCharacters = 8192;

export interface TemplateText {
  readonly text: string;
  readonly firstLine: number;
}

export interface ReadParts {
  readonly inside: readonly OverviewBlock[];
  readonly outside: readonly OverviewBlock[];
}

interface Bounded {
  readonly kept: readonly Piece[];
  readonly cutAt: number | undefined;
}

interface Read {
  readonly paragraphs: readonly Paragraph[];
  readonly cut: readonly OverviewBlock[];
}

function piecesOf(text: string): readonly Piece[] {
  const pieces: Piece[] = [];
  for (const token of new Tokenizer(text).readTopLevelTokens()) {
    const { begin, end } = token;
    const written = token.getText();
    if (TypeGuards.isTagToken(token)) {
      pieces.push({ kind: 'tag', name: token.name, args: token.args, written, begin, end });
    } else if (TypeGuards.isOutputToken(token)) {
      const { content } = token;
      pieces.push({ kind: 'output', content, written, begin, end, read: boldValue(content, written) });
    } else {
      pieces.push({
        kind: 'text',
        text: token.getContent(),
        begin: begin + token.trimLeft,
        end: end - token.trimRight,
      });
    }
  }
  return pieces;
}

function isTagNamed(piece: Piece, names: readonly string[]): boolean {
  return piece.kind === 'tag' && names.includes(piece.name);
}

function withoutComments(pieces: readonly Piece[]): readonly Piece[] {
  const shown: Piece[] = [];
  let inComment = false;
  for (const piece of pieces) {
    const opens = isTagNamed(piece, ['comment']);
    const closes: boolean = inComment && isTagNamed(piece, ['endcomment']);
    if (!inComment && !opens && !isTagNamed(piece, ['#'])) {
      shown.push(piece);
    }
    inComment = (inComment || opens) && !closes;
  }
  return shown;
}

interface RoutedPieces {
  readonly inside: readonly Piece[];
  readonly outside: readonly Piece[];
}

function routed(pieces: readonly Piece[], apart: string): RoutedPieces {
  const inside: Piece[] = [];
  const outside: Piece[] = [];
  let within = false;
  for (const piece of pieces) {
    const opens = isTagNamed(piece, [apart]);
    const closes = isTagNamed(piece, [`end${apart}`]);
    if (!opens && !closes) {
      (within ? inside : outside).push(piece);
    }
    within = (within || opens) && !closes;
  }
  return { inside, outside };
}

function cutIndexOf(text: string, room: number): number {
  const shown = firstCharacters(text, room);
  const lastBreak = shown.lastIndexOf('\n');
  if (lastBreak > 0) {
    return lastBreak + 1;
  }
  const lastSpace = Math.max(shown.lastIndexOf(' '), shown.lastIndexOf('\t'));
  return lastSpace > 0 ? lastSpace + 1 : shown.length;
}

function leadingPart(piece: TextPiece, room: number): TextPiece {
  const cut = cutIndexOf(piece.text, room);
  return { ...piece, text: piece.text.slice(0, cut), end: piece.begin + cut };
}

function withinBound(pieces: readonly Piece[]): Bounded {
  const kept: Piece[] = [];
  let used = 0;
  for (const piece of pieces) {
    const room = mostReadCharacters - used;
    const characters = charactersIn(writtenOf(piece));
    if (characters > room) {
      const part = piece.kind === 'text' ? [leadingPart(piece, room)] : [];
      return { kept: [...kept, ...part], cutAt: part.at(0)?.end ?? piece.begin };
    }
    kept.push(piece);
    used += characters;
  }
  return { kept, cutAt: undefined };
}

function readOf(pieces: readonly Piece[], lineOf: LineOfOffset): Read {
  const { kept, cutAt } = withinBound(pieces);
  return {
    paragraphs: paragraphsAsWritten(blocksOf(withInlineConstructs(kept, lineOf))),
    cut: cutAt === undefined ? [] : [paragraph(`… The rest is in the source, from line ${lineOf(cutAt)}.`)],
  };
}

function blocksOfRead({ paragraphs, cut }: Read): readonly OverviewBlock[] {
  return [...paragraphs, ...cut];
}

function quotedRead({ paragraphs, cut }: Read): readonly OverviewBlock[] {
  const quote: Quote = {
    kind: 'quote',
    lines: paragraphs.flatMap(({ phrases }, index) => (index === 0 ? [phrases] : [[], phrases])),
  };
  return [...(paragraphs.length === 0 ? [] : [quote]), ...cut];
}

function loopVariablesOf(pieces: readonly Piece[]): ReadonlySet<string> {
  return new Set(
    pieces.flatMap((piece) => {
      const item = piece.kind === 'tag' && piece.name === 'for' ? loopOf(piece.args)?.item : undefined;
      return item === undefined ? [] : [item];
    }),
  );
}

function bracketedValue(
  { content, written }: OutputPiece,
  inputSchema: JsonSchema | undefined,
  loops: ReadonlySet<string>,
): Phrase {
  const path = pathIn(content);
  return path === undefined ? { code: written } : inBrackets(valueMeaning(path, inputSchema, loops));
}

function withValuesInBrackets(pieces: readonly Piece[], inputSchema: JsonSchema | undefined): readonly Piece[] {
  const loops = loopVariablesOf(pieces);
  return pieces.map((piece) =>
    piece.kind === 'output' ? { ...piece, read: bracketedValue(piece, inputSchema, loops) } : piece,
  );
}

export function readableParts({ text, firstLine }: TemplateText, apart: string): ReadParts {
  const { inside, outside } = routed(withoutComments(piecesOf(text)), apart);
  const lineOf = linesOf(text, firstLine);
  return { inside: blocksOfRead(readOf(inside, lineOf)), outside: blocksOfRead(readOf(outside, lineOf)) };
}

export function readableTemplate({ text, firstLine }: TemplateText): readonly OverviewBlock[] {
  return blocksOfRead(readOf(withoutComments(piecesOf(text)), linesOf(text, firstLine)));
}

export function quotedTemplate(
  { text, firstLine }: TemplateText,
  inputSchema: JsonSchema | undefined,
): readonly OverviewBlock[] {
  const pieces = withValuesInBrackets(withoutComments(piecesOf(text)), inputSchema);
  return quotedRead(readOf(pieces, linesOf(text, firstLine)));
}
