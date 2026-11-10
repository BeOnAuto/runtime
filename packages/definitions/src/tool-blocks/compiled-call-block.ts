import { isServerName, isToolName, serverNameShape, toolNameShape } from '@on.auto/tool-servers/policy';
import { JsonPointer, Result, type Schema } from 'effect';

import { issueAt, type DocumentIssue, type SourceLines } from '../document/document-issue.ts';
import type { RenderClock } from '../template/render-clock.ts';
import { templatesIssues, type TemplatePlace } from './block-templates.ts';
import type { CallBlock } from './call-block-schemas.ts';
import { isJsonPointer } from './json-pointers.ts';
import { argumentsFailureWords, isOversized, renderedArguments, type Templates } from './rendered-arguments.ts';
import { callTemplates } from './template-sets.ts';

export interface DocumentReading {
  readonly lines: SourceLines;
  readonly clock: RenderClock;
}

type WrittenNames = readonly (readonly [string, string | undefined])[];

const pointerWords =
  'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1';

export function placeOf(...path: readonly string[]): string {
  return path.map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

export function nameIssues(
  lines: SourceLines,
  names: WrittenNames,
  valid: (name: string) => boolean,
  shape: string,
): readonly DocumentIssue[] {
  return names
    .filter(([, name]) => name !== undefined && !valid(name))
    .map(([pointer]) => issueAt(lines, pointer, `Expected ${shape}`));
}

function isPointerIntoAnswer(pointer: string): boolean {
  return pointer !== '' && isJsonPointer(pointer);
}

export function pointerIssues(lines: SourceLines, pointers: WrittenNames): readonly DocumentIssue[] {
  return pointers
    .filter(([, pointer]) => pointer !== undefined && !isPointerIntoAnswer(pointer))
    .map(([place]) => issueAt(lines, place, pointerWords));
}

function callArgumentIssues(written: Templates, place: TemplatePlace): readonly DocumentIssue[] {
  const pointer = placeOf('call', 'with');
  const issues = templatesIssues(callTemplates, written, { ...place, pointer });
  if (issues.length > 0) {
    return issues;
  }
  const rendered = renderedArguments(written, callTemplates.sample, place.clock);
  if (Result.isSuccess(rendered) || !isOversized(rendered.failure)) {
    return [];
  }
  const { failure } = rendered;
  const at = failure.reason === 'too_large' ? pointer : `${pointer}/${failure.argument}`;
  return [issueAt(place.lines, at, argumentsFailureWords(failure, 'the call'))];
}

export function compiledCallBlock(
  call: CallBlock,
  { lines, clock }: DocumentReading,
  inputSchema: Schema.JsonObject | undefined,
): Result.Result<CallBlock, readonly DocumentIssue[]> {
  const issues = [
    ...nameIssues(lines, [[placeOf('call', 'server'), call.server]], isServerName, serverNameShape),
    ...nameIssues(lines, [[placeOf('call', 'tool'), call.tool]], isToolName, toolNameShape),
    ...callArgumentIssues(call.with ?? {}, { lines, pointer: '', inputSchema, clock }),
    ...pointerIssues(lines, [[placeOf('call', 'read'), call.read]]),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(call);
}
