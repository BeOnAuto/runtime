import { Tokenizer, TypeGuards } from 'liquidjs';

import { charactersIn, firstCharacters } from '../plain-language/characters.ts';
import { linesOf, type LineOfOffset } from '../template/engine-failure.ts';
import { withInlineConstructs } from './inline-constructs.ts';
import { blocksOf, writtenOf, type Piece, type TextPiece } from './liquid-phrases.ts';
import { paragraph, type OverviewBlock } from './overview.ts';

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

function piecesOf(text: string): readonly Piece[] {
  const pieces: Piece[] = [];
  for (const token of new Tokenizer(text).readTopLevelTokens()) {
    const { begin, end } = token;
    const written = token.getText();
    if (TypeGuards.isTagToken(token)) {
      pieces.push({ kind: 'tag', name: token.name, args: token.args, written, begin, end });
    } else if (TypeGuards.isOutputToken(token)) {
      pieces.push({ kind: 'output', content: token.content, written, begin, end });
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

function readOf(pieces: readonly Piece[], lineOf: LineOfOffset): readonly OverviewBlock[] {
  const { kept, cutAt } = withinBound(pieces);
  const blocks = blocksOf(withInlineConstructs(kept, lineOf));
  return cutAt === undefined
    ? blocks
    : [...blocks, paragraph(`… The rest is in the source, from line ${lineOf(cutAt)}.`)];
}

export function readableParts({ text, firstLine }: TemplateText, apart: string): ReadParts {
  const { inside, outside } = routed(withoutComments(piecesOf(text)), apart);
  const lineOf = linesOf(text, firstLine);
  return { inside: readOf(inside, lineOf), outside: readOf(outside, lineOf) };
}

export function readableTemplate({ text, firstLine }: TemplateText): readonly OverviewBlock[] {
  return readOf(withoutComments(piecesOf(text)), linesOf(text, firstLine));
}
