import { isScalar, parse, parseDocument } from 'yaml';

import type { DocumentWrittenIn } from '../page/page-lines.ts';

export interface TextRenamed {
  readonly pointer: string;
  readonly from: string;
  readonly to: string;
}

interface Part {
  readonly start: number;
  readonly end: number;
}

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const yamlOptions = { schema: 'core', merge: false } as const;

const delimiter = /^\uFEFF?---[ \t]*\r?$/u;

function frontMatterOf(source: string): Part | undefined {
  const lines = source.split('\n');
  const closing = lines.findIndex((line, index) => index > 0 && delimiter.test(line));
  if (!delimiter.test(String(lines[0])) || closing === -1) {
    return undefined;
  }
  const startOf = (line: number) => lines.slice(0, line).reduce((at, text) => at + text.length + 1, 0);
  return { start: startOf(1), end: startOf(closing) };
}

function partOf(source: string, writtenIn: DocumentWrittenIn): Part | undefined {
  return writtenIn === 'workflow' ? { start: 0, end: source.length } : frontMatterOf(source);
}

function pathOf(pointer: string): readonly (string | number)[] {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((segment) => (/^\d+$/u.test(segment) ? Number(segment) : segment));
}

function readsAsWritten(text: string): boolean {
  const read: unknown = parse(text, yamlOptions);
  return read === text;
}

function scalarText(type: string | undefined, to: string): string {
  if (type === 'QUOTE_SINGLE') {
    return `'${to}'`;
  }
  return type === 'PLAIN' && readsAsWritten(to) ? to : `"${to}"`;
}

type Lookup = (path: readonly (string | number)[]) => unknown;

function spliceOf(lookup: Lookup, { start }: Part, { pointer, from, to }: TextRenamed): readonly Splice[] {
  const node = lookup(pathOf(pointer));
  if (!isScalar(node) || node.value !== from || node.range === undefined || node.range === null) {
    return [];
  }
  const [at, end] = node.range;
  return [{ start: start + at, end: start + end, text: scalarText(node.type, to) }];
}

export function renamedIn(source: string, writtenIn: DocumentWrittenIn, renamed: readonly TextRenamed[]): string {
  const part = partOf(source, writtenIn);
  if (part === undefined || renamed.length === 0) {
    return source;
  }
  const document = parseDocument(source.slice(part.start, part.end), yamlOptions);
  const lookup: Lookup = (path) => document.getIn(path, true);
  const splices = new Map(renamed.flatMap((each) => spliceOf(lookup, part, each)).map((at) => [at.start, at]));
  return [...splices.values()]
    .toSorted((one, other) => other.start - one.start)
    .reduce((text, { start, end, text: written }) => `${text.slice(0, start)}${written}${text.slice(end)}`, source);
}
