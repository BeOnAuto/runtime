import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { inputVariableIssues } from '@on.auto/definitions/template';
import type { Schema } from 'effect';

import { answerIssues } from '../rendering/answer-issues.ts';
import { cardIssues } from '../rendering/card-issues.ts';
import { layoutIssues } from '../rendering/layout-issues.ts';
import type { RenderTargetName } from '../rendering/render-targets.ts';
import { stateReadsOf, type StateRead } from '../rendering/state-reads.ts';

const stateRoots: ReadonlySet<string> = new Set(['input', 'today', 'now']);

const answerRoots: ReadonlySet<string> = new Set(['answer', 'answered']);

function segmentsOf(path: string): readonly string[] {
  return path
    .replace(/^\//u, '')
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function unknownRootDetail(path: string, takesAnswer: boolean): string {
  const answerWords = takesAnswer ? ', /answer or /answered' : '';
  return `Reads ${path}, which a request does not have; start the path with /input, /today or /now${answerWords}`;
}

function readIssues(
  { pointer, path }: StateRead,
  lines: SourceLines,
  { inputSchema, outputSchema }: CardAsked,
): readonly DocumentIssue[] {
  const segments = segmentsOf(path);
  const line = issueAt(lines, pointer, '').line;
  const root = String(segments[0]);
  if (path.startsWith('/') && outputSchema !== undefined && answerRoots.has(root)) {
    return [];
  }
  if (!path.startsWith('/') || !stateRoots.has(root)) {
    return [issueAt(lines, pointer, unknownRootDetail(path, outputSchema !== undefined))];
  }
  return inputVariableIssues([{ path: segments, line }], inputSchema, 'the message of a request').map(({ detail }) =>
    issueAt(lines, pointer, detail),
  );
}

export interface CardAsked {
  readonly inputSchema: Schema.JsonObject | undefined;
  readonly outputSchema: Schema.JsonObject | undefined;
}

export function cardBodyIssues(
  target: RenderTargetName,
  card: Schema.Json,
  lines: SourceLines,
  asked: CardAsked,
): readonly DocumentIssue[] {
  const takesAnswer = asked.outputSchema !== undefined;
  return [
    ...cardIssues(target, card, takesAnswer).map(({ pointer, detail }) => issueAt(lines, pointer, detail)),
    ...stateReadsOf(card).flatMap((read) => readIssues(read, lines, asked)),
    ...layoutIssues(card, takesAnswer).map(({ pointer, detail }) => issueAt(lines, pointer, detail)),
    ...answerIssues(card, asked.outputSchema).map(({ pointer, detail }) => issueAt(lines, pointer, detail)),
  ];
}
