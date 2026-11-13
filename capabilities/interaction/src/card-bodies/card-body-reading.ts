import type { DocumentIssue, DocumentParts, SourceLines } from '@on.auto/definitions/document';
import { JsonPointer, Result, type Schema } from 'effect';
import { isMap, isNode, isSeq, LineCounter, parseDocument, visit } from 'yaml';

import { jsonOf } from '../rendering/json-values.ts';

export interface CardBody {
  readonly card: Schema.Json;
  readonly lines: SourceLines;
}

interface YamlError {
  readonly pos: readonly [number, number];
  readonly message: string;
}

interface AliasNode {
  readonly source: string;
}

const noBody = 'The definition has no message: write its card, with root and elements, after the front matter';

const parseOptions = {
  schema: 'core',
  version: '1.2',
  strict: true,
  merge: false,
  uniqueKeys: true,
  stringKeys: true,
  prettyErrors: false,
} as const;

function offsetOf(node: unknown): number | undefined {
  return isNode(node) ? node.range?.[0] : undefined;
}

function linesOf(contents: unknown, bodyLine: number, lineAt: (node: unknown, fallback: number) => number) {
  const lines = new Map<string, number>([['', bodyLine]]);
  const walk = (node: unknown, pointer: string, fallback: number): void => {
    const line = lineAt(node, fallback);
    if (!lines.has(pointer)) {
      lines.set(pointer, line);
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = String(pair.key);
        const at = `${pointer}/${JsonPointer.escapeToken(key)}`;
        const keyLine = lineAt(pair.key, line);
        lines.set(at, keyLine);
        walk(pair.value, at, keyLine);
      }
    }
    if (isSeq(node)) {
      node.items.forEach((item, index) => {
        walk(item, `${pointer}/${index}`, line);
      });
    }
  };
  walk(contents, '', bodyLine);
  return lines;
}

export function readCardBody({ body, bodyLine }: DocumentParts): Result.Result<CardBody, readonly DocumentIssue[]> {
  const lineCounter = new LineCounter();
  const document = parseDocument(body, { ...parseOptions, lineCounter });
  const lineAt = (node: unknown, fallback: number): number => {
    const offset = offsetOf(node);
    return offset === undefined ? fallback : bodyLine + lineCounter.linePos(offset).line - 1;
  };
  if (document.errors.length > 0) {
    const errors: readonly YamlError[] = document.errors;
    return Result.fail(
      errors.map(({ pos, message }) => ({
        line: bodyLine + lineCounter.linePos(pos[0]).line - 1,
        pointer: '',
        detail: message,
      })),
    );
  }
  if (document.contents === null) {
    return Result.fail([{ line: bodyLine, pointer: '', detail: noBody }]);
  }
  const aliases: DocumentIssue[] = [];
  visit(document, {
    Alias: (_key: unknown, node: AliasNode) => {
      aliases.push({
        line: lineAt(node, bodyLine),
        pointer: '',
        detail: `An alias (*${node.source}) is not allowed; write the value out`,
      });
    },
  });
  if (aliases.length > 0) {
    return Result.fail(aliases);
  }
  return Result.mapBoth(jsonOf(document.toJS(), 'The body'), {
    onSuccess: (card) => ({ card, lines: linesOf(document.contents, bodyLine, lineAt) }),
    onFailure: (issues) => issues.map((detail) => ({ line: bodyLine, pointer: '', detail })),
  });
}
