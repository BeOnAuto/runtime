import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';

import { refusedAt } from '../document/checked-parts.ts';
import type { DatasetFilter } from '../document/prediction-document.ts';

type Carries = (tokens: readonly string[]) => boolean;

const carriesNothing: Carries = () => false;

const carriedData: ReadonlyMap<string, Carries> = new Map([
  ['run_started', carriesNothing],
  ['run_failed', carriesNothing],
  ['definition_created', carriesNothing],
  ['definition_updated', carriesNothing],
  ['definition_retired', carriesNothing],
  ['run_succeeded', (tokens) => tokens[0] === 'output' || (tokens.length === 1 && tokens[0] === 'output_bytes')],
  [
    'run_rejected',
    (tokens) => tokens.length <= 1 && (tokens[0] === undefined || ['reason', 'kind'].includes(tokens[0])),
  ],
]);

const heldWhere: ReadonlyMap<string, string> = new Map([
  ['run_succeeded', 'a run_succeeded event holds the run’s output under /output'],
  ['run_rejected', 'a run_rejected event holds /reason and /kind'],
]);

const pointerGrammar = /^(?:\/(?:[^~/]|~[01])*)*$/u;

export const eventTime = 'event';

function tokensOf(pointer: string): readonly string[] {
  return pointer === ''
    ? []
    : pointer
        .slice(1)
        .split('/')
        .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function isCarriedBy(type: string, tokens: readonly string[]): boolean {
  const carries = carriedData.get(type);
  return carries === undefined || (tokens.length === 0 ? carries !== carriesNothing : carries(tokens));
}

function notCarriedWords(pointer: string, types: readonly string[]): string {
  const where = types.flatMap((type) => {
    const held = heldWhere.get(type);
    return held === undefined ? [] : [held];
  });
  const known = where.length === 0 ? 'the events the filters name hold no data' : where.join(', and ');
  return `None of the events the filters name holds a value at ${pointer === '' ? 'the root of its data' : pointer}: ${known}`;
}

export function pointerIssues(
  pointer: string,
  at: string,
  filters: readonly DatasetFilter[],
  lines: SourceLines,
): readonly DocumentIssue[] {
  if (!pointerGrammar.test(pointer)) {
    return refusedAt(
      lines,
      at,
      `${pointer} is not a JSON Pointer into an event's data, such as /order/region; write ~1 for a slash and ~0 for a tilde in a key`,
    );
  }
  const types = [...new Set(filters.map(({ type }) => type))];
  const tokens = tokensOf(pointer);
  return types.some((type) => isCarriedBy(type, tokens)) ? [] : refusedAt(lines, at, notCarriedWords(pointer, types));
}

export function valueAt(data: unknown, pointer: string): unknown {
  return tokensOf(pointer).reduce<unknown>(
    (value, token) =>
      value !== null && typeof value === 'object' && Object.hasOwn(value, token)
        ? Reflect.get(value, token)
        : undefined,
    data,
  );
}
