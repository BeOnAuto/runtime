import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { inputVariableIssues } from '@on.auto/definitions/template';
import type { Schema } from 'effect';

import { cardIssues } from '../rendering/card-issues.ts';
import type { RenderTargetName } from '../rendering/render-targets.ts';
import { stateReadsOf, type StateRead } from '../rendering/state-reads.ts';

const stateRoots: ReadonlySet<string> = new Set(['input', 'today', 'now']);

function segmentsOf(path: string): readonly string[] {
  return path
    .replace(/^\//u, '')
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function unknownRootDetail(path: string): string {
  return `Reads ${path}, which a request does not have; start the path with /input, /today or /now`;
}

function readIssues(
  { pointer, path }: StateRead,
  lines: SourceLines,
  inputSchema: Schema.JsonObject | undefined,
): readonly DocumentIssue[] {
  const segments = segmentsOf(path);
  const line = issueAt(lines, pointer, '').line;
  if (!path.startsWith('/') || !stateRoots.has(String(segments[0]))) {
    return [issueAt(lines, pointer, unknownRootDetail(path))];
  }
  return inputVariableIssues([{ path: segments, line }], inputSchema, 'the message of a request').map(({ detail }) =>
    issueAt(lines, pointer, detail),
  );
}

export function cardBodyIssues(
  target: RenderTargetName,
  card: Schema.Json,
  lines: SourceLines,
  inputSchema: Schema.JsonObject | undefined,
): readonly DocumentIssue[] {
  return [
    ...cardIssues(target, card).map(({ pointer, detail }) => issueAt(lines, pointer, detail)),
    ...stateReadsOf(card).flatMap((read) => readIssues(read, lines, inputSchema)),
  ];
}
