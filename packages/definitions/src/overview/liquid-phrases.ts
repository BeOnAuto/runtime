import { Tokenizer, TypeGuards } from 'liquidjs';

import type { VariableSegment } from '../template/template-parsing.ts';
import { named, paragraph, type Paragraph, type Phrase, type Phrases } from './overview.ts';

export interface TextPiece {
  readonly kind: 'text';
  readonly text: string;
  readonly begin: number;
  readonly end: number;
}

export interface OutputPiece {
  readonly kind: 'output';
  readonly content: string;
  readonly written: string;
  readonly begin: number;
  readonly end: number;
  readonly read: Phrase;
}

export interface TagPiece {
  readonly kind: 'tag';
  readonly name: string;
  readonly args: string;
  readonly written: string;
  readonly begin: number;
  readonly end: number;
}

export type Piece = TextPiece | OutputPiece | TagPiece;

interface InlineConstruct {
  readonly kind: 'inline';
  readonly phrases: Phrases;
}

export type ReadPiece = Piece | InlineConstruct;

interface Loop {
  readonly item: string;
  readonly list: string;
}

interface Line {
  readonly line: string;
}

const paragraphBreak = Symbol('paragraph break');

type Unit = Phrase | Line | typeof paragraphBreak;

const blockEnd = /^end[a-z]+$/u;

const endsOfReadBlocks: ReadonlySet<string> = new Set(['endif', 'endunless', 'endfor']);

const loop = /^\s*(?<item>[\w-]+)\s+in\s+(?<list>\S[\s\S]*)$/u;

export function pathIn(content: string): readonly VariableSegment[] | undefined {
  const value = new Tokenizer(content).readValue();
  if (!TypeGuards.isPropertyAccessToken(value) || value.variable !== undefined) {
    return undefined;
  }
  const path: VariableSegment[] = [];
  for (const segment of value.props) {
    if (TypeGuards.isWordToken(segment)) {
      path.push(segment.getText());
    } else if (TypeGuards.isQuotedToken(segment)) {
      path.push(segment.content);
    } else {
      path.push(TypeGuards.isNumberToken(segment) ? Number(segment.getText()) : null);
    }
  }
  return path;
}

export function boldValue(content: string, written: string): Phrase {
  const name = pathIn(content)?.findLast((segment) => typeof segment === 'string');
  return name === undefined ? { code: written } : named(name);
}

export function writtenOf(piece: Piece): string {
  return piece.kind === 'text' ? piece.text : piece.written;
}

export function asWritten(args: string): string {
  return args.trim().replaceAll(/\s+/gu, ' ');
}

export function loopOf(args: string): Loop | undefined {
  const { item, list } = loop.exec(args)?.groups ?? {};
  return item === undefined || list === undefined ? undefined : { item, list: asWritten(list) };
}

function loopUnits({ args, written }: TagPiece): readonly Unit[] {
  const read = loopOf(args);
  return read === undefined ? [{ code: written }] : [{ line: `For each ${read.item} of ${read.list}:` }];
}

function tagPhrases({ name, written }: TagPiece): Phrases {
  return name === 'raw' || blockEnd.test(name) ? [] : [{ code: written }];
}

function tagUnits(piece: TagPiece): readonly Unit[] {
  const { name, args } = piece;
  switch (name) {
    case 'if': {
      return [{ line: `When ${asWritten(args)}:` }];
    }
    case 'unless': {
      return [{ line: `Unless ${asWritten(args)}:` }];
    }
    case 'elsif': {
      return [{ line: `Or when ${asWritten(args)}:` }];
    }
    case 'else': {
      return [{ line: 'Otherwise:' }];
    }
    case 'for': {
      return loopUnits(piece);
    }
    default: {
      return endsOfReadBlocks.has(name) ? [paragraphBreak] : tagPhrases(piece);
    }
  }
}

export function phrasesOf(piece: ReadPiece): Phrases {
  if (piece.kind === 'text') {
    return [piece.text];
  }
  if (piece.kind === 'output') {
    return [piece.read];
  }
  return piece.kind === 'tag' ? tagPhrases(piece) : piece.phrases;
}

function unitsOf(piece: ReadPiece): readonly Unit[] {
  return piece.kind === 'tag' ? tagUnits(piece) : phrasesOf(piece);
}

function paragraphsIn(text: string): readonly string[] {
  const lines = text.split('\n');
  const last = lines.length - 1;
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0 && index < last && line.trim() === '') {
      paragraphs.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  return [...paragraphs, current.join('\n')];
}

function marksOf(unit: Unit): readonly Unit[] {
  if (typeof unit !== 'string') {
    return [unit];
  }
  return paragraphsIn(unit).flatMap((part, index) => (index > 0 ? [paragraphBreak, part] : [part]));
}

function isLine(mark: Unit): mark is Line {
  return typeof mark === 'object' && 'line' in mark;
}

function merged(phrases: Phrases): Phrases {
  const joined: Phrase[] = [];
  for (const phrase of phrases) {
    const previous = joined.at(-1);
    if (typeof phrase === 'string' && typeof previous === 'string') {
      joined[joined.length - 1] = `${previous}${phrase}`;
    } else {
      joined.push(phrase);
    }
  }
  return joined;
}

export function trimmed(phrases: Phrases): Phrases {
  const whole = merged(phrases);
  const last = whole.length - 1;
  return whole
    .map((phrase, index) => {
      if (typeof phrase !== 'string') {
        return phrase;
      }
      const started = index === 0 ? phrase.trimStart() : phrase;
      return index === last ? started.trimEnd() : started;
    })
    .filter((phrase) => phrase !== '');
}

export function blocksOf(pieces: readonly ReadPiece[]): readonly Paragraph[] {
  const blocks: Paragraph[] = [];
  let current: Phrase[] = [];
  const close = (): void => {
    const phrases = trimmed(current);
    blocks.push(...(phrases.length > 0 ? [paragraph(...phrases)] : []));
    current = [];
  };
  for (const mark of pieces.flatMap((piece) => unitsOf(piece)).flatMap((unit) => marksOf(unit))) {
    if (mark === paragraphBreak) {
      close();
    } else if (isLine(mark)) {
      close();
      blocks.push(paragraph({ emphasis: mark.line }));
    } else {
      current.push(mark);
    }
  }
  close();
  return blocks;
}
