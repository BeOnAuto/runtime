import { JsonPointer, Result, type Schema } from 'effect';
import {
  isAlias,
  isCollection,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';

import type { DocumentIssue, SourceLines } from './document-issue.ts';
import type { TextPosition } from './written-texts.ts';

export interface FrontMatterReading {
  readonly value: Schema.JsonObject;
  readonly lines: SourceLines;
  readonly positions: ReadonlyMap<string, TextPosition>;
}

const frontMatterNesting = 72;

const tooDeep = `The front matter may nest at most ${frontMatterNesting} levels`;

const stackOverflow = 'Maximum call stack size exceeded';

interface Place {
  readonly pointer: string;
  readonly depth: number;
  readonly line: number;
}

interface Reading {
  readonly report: (line: number, pointer: string, detail: string) => void;
  readonly locate: (pointer: string, line: number) => void;
  readonly position: (pointer: string, node: unknown) => void;
  readonly lineOf: (node: unknown, fallback: number) => number;
}

interface YamlError {
  readonly code: string;
  readonly pos: readonly [number, number];
  readonly message: string;
}

const parseOptions = {
  schema: 'core',
  version: '1.2',
  strict: true,
  merge: false,
  uniqueKeys: false,
  stringKeys: true,
  prettyErrors: false,
} as const;

function rejectionOf(node: unknown): string | undefined {
  if (isAlias(node)) {
    return `An alias (*${node.source}) is not allowed; write the value out`;
  }
  if ((isScalar(node) || isCollection(node)) && node.anchor !== undefined) {
    return `An anchor (&${node.anchor}) is not allowed`;
  }
  return isNode(node) && node.tag !== undefined ? `A tag (${node.tag}) is not allowed` : undefined;
}

function scalarOf(value: unknown): Schema.Json | undefined {
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function valueOf(node: unknown, place: Place, reading: Reading): Schema.Json {
  const line = reading.lineOf(node, place.line);
  const here = { ...place, line };
  reading.locate(place.pointer, line);
  const rejection = rejectionOf(node);
  if (rejection !== undefined) {
    reading.report(line, place.pointer, rejection);
    return null;
  }
  if (place.depth > frontMatterNesting) {
    reading.report(line, place.pointer, tooDeep);
    return null;
  }
  if (isMap(node)) {
    return objectOf(() => node, here, reading);
  }
  if (isSeq(node)) {
    return listOf(() => node, here, reading);
  }
  const value = scalarOf(isScalar(node) ? node.value : null);
  if (value === undefined) {
    reading.report(line, place.pointer, 'Expected text, a finite number, true, false or null');
    return null;
  }
  if (typeof value === 'string') {
    reading.position(place.pointer, node);
  }
  return value;
}

function objectOf(map: () => YAMLMap, place: Place, reading: Reading): Schema.JsonObject {
  const entries: [string, Schema.Json][] = [];
  const keys = new Set<string>();
  for (const pair of map().items) {
    const key = String(pair.key);
    const pointer = `${place.pointer}/${JsonPointer.escapeToken(key)}`;
    const line = reading.lineOf(pair.key, place.line);
    if (keys.has(key)) {
      reading.report(line, pointer, `The key ${key} appears more than once`);
    }
    keys.add(key);
    entries.push([key, valueOf(pair.value, { pointer, depth: place.depth + 1, line }, reading)]);
  }
  return Object.fromEntries(entries);
}

function listOf(seq: () => YAMLSeq, place: Place, reading: Reading): Schema.Json {
  return seq().items.map((item, index) =>
    valueOf(item, { pointer: `${place.pointer}/${index}`, depth: place.depth + 1, line: place.line }, reading),
  );
}

function rootIssue(line: number, detail: string): readonly DocumentIssue[] {
  return [{ line, pointer: '', detail }];
}

function yamlIssues(errors: readonly YamlError[], lineAt: (offset: number) => number): readonly DocumentIssue[] {
  const issues: readonly DocumentIssue[] = errors.map(({ code, pos, message }: YamlError) => ({
    line: lineAt(pos[0]),
    pointer: '',
    detail: code === 'RESOURCE_EXHAUSTION' || message === stackOverflow ? tooDeep : message,
  }));
  return [...new Map(issues.map((issue) => [`${issue.line} ${issue.detail}`, issue])).values()];
}

function offsetOf(node: unknown): number | undefined {
  return isNode(node) ? node.range?.[0] : undefined;
}

export function readFrontMatter(
  text: string,
  firstLine: number,
  required: string,
  positioned: ReadonlySet<string>,
): Result.Result<FrontMatterReading, readonly DocumentIssue[]> {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { ...parseOptions, lineCounter });
  const lineAt = (offset: number): number => firstLine + lineCounter.linePos(offset).line - 1;
  if (document.errors.length > 0) {
    return Result.fail(yamlIssues(document.errors, lineAt));
  }
  if (document.contents === null) {
    return Result.fail(rootIssue(firstLine, `The front matter is empty; it names at least ${required}`));
  }
  const { contents } = document;
  if (!isMap(contents)) {
    return Result.fail(rootIssue(firstLine, 'The front matter is a mapping of keys to values'));
  }
  const rejection = rejectionOf(contents);
  if (rejection !== undefined) {
    return Result.fail(rootIssue(firstLine, rejection));
  }
  const issues: DocumentIssue[] = [];
  const lines = new Map<string, number>([['', firstLine]]);
  const positions = new Map<string, TextPosition>();
  const value = objectOf(
    () => contents,
    { pointer: '', depth: 0, line: firstLine },
    {
      report: (line, pointer, detail) => {
        issues.push({ line, pointer, detail });
      },
      locate: (pointer, line) => {
        lines.set(pointer, line);
      },
      position: (pointer, node) => {
        const offset = offsetOf(node);
        if (offset !== undefined && positioned.has(pointer)) {
          positions.set(pointer, { line: lineAt(offset), column: lineCounter.linePos(offset).col });
        }
      },
      lineOf: (node, fallback) => {
        const offset = offsetOf(node);
        return offset === undefined ? fallback : lineAt(offset);
      },
    },
  );
  return issues.length > 0 ? Result.fail(issues) : Result.succeed({ value, lines, positions });
}
