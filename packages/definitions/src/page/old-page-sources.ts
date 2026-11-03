import { Option, Result } from 'effect';

import type { PageBlock, PageDefinitionDocument } from './page-document.ts';
import { pageIn } from './page-key.ts';
import { parsePageDocument } from './page-parsing.ts';

const frontMatterDelimiter = /^---[ \t]*\r?$/u;

const dataKey = /^data[ \t]*:/u;

const topLevel = /^\S/u;

function frontMatterLinesOf(source: string): readonly string[] {
  const lines = source.split('\n');
  const closing = lines.findIndex((line, index) => index > 0 && frontMatterDelimiter.test(line));
  return lines.slice(1, closing);
}

function dataLinesOf(source: string): readonly string[] {
  const lines = frontMatterLinesOf(source);
  const key = lines.findIndex((line) => dataKey.test(line));
  const next = lines.findIndex((line, index) => index > key && topLevel.test(line));
  return key === -1 ? [] : lines.slice(key, next === -1 ? lines.length : next);
}

function blockLinesOf(key: string, block: PageBlock | undefined): readonly string[] {
  if (block === undefined) {
    return [];
  }
  const text = block.text.replace(/^\r?\n/u, '').replace(/\r?\n[ \t]*$/u, '');
  return [`${key}: |2`, ...text.split('\n').map((line) => (line.trim() === '' ? '' : `  ${line}`))];
}

function pageMappingOfOld(source: string, { blocks }: PageDefinitionDocument): string {
  return [
    ...dataLinesOf(source),
    ...blockLinesOf('result', blocks.result),
    ...blockLinesOf('runs', blocks.runs),
    '',
  ].join('\n');
}

export interface CarriedSource {
  readonly source: string;
  readonly document: PageDefinitionDocument;
}

export function carriedPageSourceOf(old: string, ofThePlaybook: boolean): CarriedSource | undefined {
  const parsed = parsePageDocument(old, ofThePlaybook ? 'playbook' : 'definition');
  const source = Result.isFailure(parsed) ? '' : pageMappingOfOld(old, parsed.success);
  const read = Option.getOrUndefined(
    Result.getOrElse(pageIn(source, ofThePlaybook ? 'playbook' : 'mapping'), Option.none),
  );
  return read === undefined || read === null ? undefined : { source, document: read };
}
