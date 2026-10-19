import { quoted } from '@on.auto/operations';
import type { Schema } from 'effect';

import {
  detailsHeading,
  detailsLinesIn,
  headingLinesIn,
  unclosedBlockIn,
  type UnclosedBlock,
} from '../overview/markdown-text.ts';
import type { DocumentIssue } from './document-issue.ts';

interface TextSource {
  readonly lines: readonly string[];
  readonly firstLine: number;
}

export interface TextPosition {
  readonly line: number;
  readonly column: number;
}

interface TextIssue extends TextPosition {
  readonly detail: string;
}

interface Finding {
  readonly index: number;
  readonly opening: string;
  readonly detail: (where: string) => string;
}

export const describingPointers: readonly string[] = ['/description', '/about'];

const literalBlock = /^\|/u;

const blanks = /[ \t]+/u;

const mostOpeningWords = 4;

function openingWordsOf(line: string): string {
  return line
    .split(blanks)
    .filter((word) => word !== '')
    .slice(0, mostOpeningWords)
    .join(' ');
}

function findingsAt(
  lines: readonly string[],
  indexes: readonly number[],
  detail: (where: string) => string,
): readonly Finding[] {
  return lines.flatMap((line, index) =>
    indexes.includes(index) ? [{ index, opening: openingWordsOf(line), detail }] : [],
  );
}

function detailsWords(key: string, where: string): string {
  return `${key} may not hold the line ${detailsHeading}, which is the overview's own, since the page that shows an overview splits it at that text: ${where} is one`;
}

function headingWords(key: string, where: string): string {
  return `${key} takes no heading, since an overview writes its own: ${where} makes one, with # before its words or as a line of = or - under the words above it`;
}

function unclosedWords(key: string, unclosed: UnclosedBlock | undefined, where: string): string {
  const block = unclosed?.kind === 'fence' ? 'fence' : 'HTML block';
  return `${key} leaves open the ${block} that ${where} opens, so the rest of the overview would be read inside it: close it`;
}

function findingsIn(key: string, text: string): readonly Finding[] {
  const lines = text.split('\n');
  const details = detailsLinesIn(text);
  const headings = headingLinesIn(text).filter((index) => !details.includes(index));
  const unclosed = unclosedBlockIn(text);
  return [
    ...findingsAt(lines, details, (where) => detailsWords(key, where)),
    ...findingsAt(lines, headings, (where) => headingWords(key, where)),
    ...findingsAt(lines, unclosed === undefined ? [] : [unclosed.line], (where) => unclosedWords(key, unclosed, where)),
  ];
}

function lineAt({ lines, firstLine }: TextSource, line: number): string {
  return lines[line - firstLine] ?? '';
}

function columnOfText(line: string): number {
  return line.length - line.trimStart().length + 1;
}

function placed(findings: readonly Finding[], source: TextSource, opens: TextPosition): readonly TextIssue[] {
  const literal = literalBlock.test(lineAt(source, opens.line).slice(opens.column - 1));
  return findings
    .toSorted((one, other) => one.index - other.index)
    .map(({ index, opening, detail }) => {
      const line = opens.line + 1 + index;
      return literal
        ? { line, column: columnOfText(lineAt(source, line)), detail: detail('this line') }
        : { line: opens.line, column: opens.column, detail: detail(`the line that begins ${quoted(opening)}`) };
    });
}

export function writtenTextIssues(
  text: string,
  key: string,
  source: TextSource,
  opens: TextPosition,
): readonly TextIssue[] {
  return placed(findingsIn(key, text), source, opens);
}

export function frontMatterTextIssues(
  { root, positions }: { readonly root: Schema.JsonObject; readonly positions: ReadonlyMap<string, TextPosition> },
  source: TextSource,
): readonly DocumentIssue[] {
  return describingPointers.flatMap((pointer) => {
    const key = pointer.slice(1);
    const text = root[key];
    const opens = positions.get(pointer);
    return typeof text === 'string' && opens !== undefined
      ? writtenTextIssues(text, key, source, opens).map(({ line, detail }) => ({ line, pointer, detail }))
      : [];
  });
}
