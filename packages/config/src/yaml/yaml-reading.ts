import { Schema } from 'effect';
import { isAlias, isMap, isNode, isPair, isScalar, isSeq, LineCounter, parseDocument, Parser } from 'yaml';

export interface Position {
  readonly line: number;
  readonly column: number;
}

export interface LocatedProblem {
  readonly position: Position;
  readonly detail: string;
}

export interface YamlKind {
  readonly noun: string;
  readonly mapping: string;
  readonly mostDepth: number;
  readonly emptyIsMapping: boolean;
}

export interface YamlDocument {
  readonly value: Schema.JsonObject;
  readonly locate: (pointer: string) => Position;
}

export type YamlReading = { readonly document: YamlDocument } | { readonly problems: readonly LocatedProblem[] };

interface ParserMessage {
  readonly message: string;
  readonly pos: readonly [number, number];
}

type Locator = (offset: number) => Position;

interface Nested {
  readonly token: object;
  readonly depth: number;
}

type Lookup = (path: readonly (string | number)[]) => unknown;

const start: Position = { line: 1, column: 1 };

const isJsonObject = Schema.is(Schema.JsonObject);

export function readYaml(source: string, kind: YamlKind): YamlReading {
  const tooDeep = tooDeepIn(source, kind.mostDepth);
  return tooDeep === undefined
    ? readDocument(source, kind)
    : {
        problems: [{ position: tooDeep, detail: `The document nests values more than ${kind.mostDepth} levels deep` }],
      };
}

function tooDeepIn(source: string, mostDepth: number): Position | undefined {
  const lines = new LineCounter();
  const parser = new Parser((offset: number) => {
    lines.addNewLine(offset);
  });
  const pending: Nested[] = [...parser.parse(source)].map((token: object) => ({ token, depth: 0 }));
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const items = tokenField(next.token, 'items');
    const depth = Array.isArray(items) ? next.depth + 1 : next.depth;
    if (depth > mostDepth) {
      const { line, col } = lines.linePos(Number(tokenField(next.token, 'offset')));
      return { line, column: col };
    }
    const children: readonly unknown[] = Array.isArray(items)
      ? items.flatMap((item: object) => [tokenField(item, 'key'), tokenField(item, 'value')])
      : [tokenField(next.token, 'value')];
    pending.push(...children.filter((child) => isToken(child)).map((token) => ({ token, depth })));
  }
  return undefined;
}

function tokenField(token: object, key: string): unknown {
  return Reflect.get(token, key);
}

function isToken(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function readDocument(source: string, kind: YamlKind): YamlReading {
  const lines = new LineCounter();
  const parsed = parseDocument(source, {
    lineCounter: lines,
    prettyErrors: true,
    uniqueKeys: true,
    strict: true,
    schema: 'core',
    merge: false,
  });
  const at: Locator = (offset) => {
    const { line, col } = lines.linePos(offset);
    return { line, column: col };
  };
  const problems = [
    ...messageProblems([...parsed.errors, ...parsed.warnings], at),
    ...unsafeNodes(parsed.contents, at, kind.noun),
  ];
  if (problems.length > 0) {
    return { problems };
  }
  const value: unknown = parsed.contents === null && kind.emptyIsMapping ? {} : parsed.toJS({ maxAliasCount: 0 });
  if (!isJsonObject(value)) {
    return { problems: [{ position: start, detail: kind.mapping }] };
  }
  const lookup: Lookup = (path) => parsed.getIn(path, true);
  return { document: { value, locate: (pointer) => locatePath(lookup, pathOf(pointer), at) } };
}

function messageProblems(messages: readonly ParserMessage[], at: Locator): readonly LocatedProblem[] {
  return messages.map(({ message, pos }) => ({
    position: at(pos[0]),
    detail: message
      .split('\n', 1)
      .join('')
      .replace(/ at line \d+, column \d+:$/u, ''),
  }));
}

function unsafeNodes(root: unknown, at: Locator, noun: string): readonly LocatedProblem[] {
  const problems: LocatedProblem[] = [];
  const pending: unknown[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const detail = isPair(node) ? keyUnsafety(node.key, noun) : nodeUnsafety(node, noun);
    if (detail !== undefined) {
      problems.push({ position: at(offsetOf(isPair(node) ? node.key : node)), detail });
    }
    pending.push(...childrenOf(node));
  }
  return problems.toReversed();
}

function keyUnsafety(key: unknown, noun: string): string | undefined {
  return key === null || isScalar(key) ? undefined : `Keys in ${noun} are plain text`;
}

function nodeUnsafety(node: unknown, noun: string): string | undefined {
  if (isAlias(node)) {
    return `Aliases are not allowed in ${noun}`;
  }
  if (!isNode(node)) {
    return undefined;
  }
  if (node.anchor !== undefined) {
    return `Anchors are not allowed in ${noun}`;
  }
  if (node.tag !== undefined) {
    return `Tags are not allowed in ${noun}: ${node.tag}`;
  }
  return isScalar(node) && typeof node.value === 'number' && !Number.isFinite(node.value)
    ? `Numbers in ${noun} are finite`
    : undefined;
}

function childrenOf(node: unknown): readonly unknown[] {
  if (isMap(node) || isSeq(node)) {
    return node.items;
  }
  return isPair(node) ? [node.key, node.value] : [];
}

export function offsetOf(node: unknown): number {
  const range: unknown = typeof node === 'object' && node !== null ? Reflect.get(node, 'range') : undefined;
  return Array.isArray(range) && typeof range[0] === 'number' ? range[0] : 0;
}

function pathOf(pointer: string): readonly (string | number)[] {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((segment) => (/^\d+$/u.test(segment) ? Number(segment) : segment));
}

function locatePath(lookup: Lookup, path: readonly (string | number)[], at: Locator): Position {
  if (path.length === 0) {
    return start;
  }
  const node = lookup(path);
  return isNode(node) ? at(offsetOf(node)) : locatePath(lookup, path.slice(0, -1), at);
}
