import { Lexer } from 'marked';

interface LexerCell {
  readonly text: string;
  readonly tokens: readonly LexerToken[];
}

interface LexerToken {
  readonly type: string;
  readonly raw: string;
  readonly text?: string;
  readonly depth?: number;
  readonly tokens?: readonly LexerToken[];
  readonly items?: readonly LexerToken[];
  readonly header?: readonly LexerCell[];
  readonly rows?: readonly (readonly LexerCell[])[];
}

export interface Cell {
  readonly text: string;
  readonly tokens: readonly Token[];
}

export interface Token {
  readonly type: string;
  readonly raw: string;
  readonly text: string;
  readonly depth: number;
  readonly tokens: readonly Token[];
  readonly items: readonly Token[];
  readonly header: readonly Cell[];
  readonly rows: readonly (readonly Cell[])[];
}

export interface Placed {
  readonly token: Token;
  readonly at: number;
}

const markingAttribute = /(?<![\w.:-])data-(?:audience|variable)(?![\w.:-])/giu;

function cellOf({ text, tokens }: LexerCell): Cell {
  return { text, tokens: tokens.map((token) => tokenOf(token)) };
}

function tokenOf(token: LexerToken): Token {
  return {
    type: token.type,
    raw: token.raw,
    text: token.text ?? '',
    depth: token.depth ?? 0,
    tokens: (token.tokens ?? []).map((each) => tokenOf(each)),
    items: (token.items ?? []).map((each) => tokenOf(each)),
    header: (token.header ?? []).map((cell) => cellOf(cell)),
    rows: (token.rows ?? []).map((row) => row.map((cell) => cellOf(cell))),
  };
}

export function lexed(text: string): readonly Token[] {
  const tokens: readonly LexerToken[] = Lexer.lex(text, { gfm: true });
  return tokens.map((token) => tokenOf(token));
}

export function placedFrom(tokens: readonly Token[], start: number): readonly Placed[] {
  const placed: Placed[] = [];
  let at = start;
  for (const token of tokens) {
    placed.push({ token, at });
    at += token.raw.length;
  }
  return placed;
}

export function rawsOf(tokens: readonly Token[]): string {
  return tokens.map(({ raw }) => raw).join('');
}

export function cellsOf({ header, rows }: Token): readonly Cell[] {
  return [...header, ...rows.flat()];
}

function childrenOf(token: Token): readonly Token[] {
  return [...token.tokens, ...token.items, ...cellsOf(token).flatMap(({ tokens }) => tokens)];
}

export function everyTokenOf(tokens: readonly Token[]): readonly Token[] {
  return tokens.flatMap((token) => [token, ...everyTokenOf(childrenOf(token))]);
}

export function markingsWrittenIn(text: string): number {
  return text.match(markingAttribute)?.length ?? 0;
}

export function holdsAMarking(token: Token): boolean {
  return everyTokenOf([token]).some((each) => each.type === 'html' && markingsWrittenIn(each.raw) > 0);
}
