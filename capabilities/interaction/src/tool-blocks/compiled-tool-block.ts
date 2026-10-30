import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import type { RenderClock } from '@on.auto/definitions/template';
import { isServerName, isToolName, serverNameShape, toolNameShape } from '@on.auto/tool-servers/policy';
import { readDuration } from '@on.auto/workflow-engine/dsl';
import { JsonPointer, Result, type Schema } from 'effect';

import { templateIssues, templatesIssues, type TemplatePlace } from './block-templates.ts';
import { isJsonPointer } from './json-pointers.ts';
import {
  argumentsFailureWords,
  renderedArguments,
  type ArgumentsFailure,
  type Templates,
} from './rendered-arguments.ts';
import {
  callTemplates,
  conversationTemplates,
  deliveryTemplates,
  readingTemplates,
  tellingTemplates,
} from './template-sets.ts';
import type { CallBlock, DeliverBlock, Replies } from './tool-block-schemas.ts';

export interface WrittenRoute {
  readonly deliver: DeliverBlock;
  readonly replies?: Replies | undefined;
}

const replyWaitBounds = { leastMs: 5000, mostMs: 3_600_000 } as const;

const pointerWords =
  'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1';

const waitWords = 'Expected an ISO 8601 duration from PT5S to PT1H, such as PT1M';

export interface DocumentReading {
  readonly lines: SourceLines;
  readonly clock: RenderClock;
}

function placeOf(...path: readonly string[]): string {
  return path.map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

function nameIssues(
  lines: SourceLines,
  names: readonly (readonly [string, string | undefined])[],
  valid: (name: string) => boolean,
  shape: string,
) {
  return names
    .filter(([, name]) => name !== undefined && !valid(name))
    .map(([pointer]) => issueAt(lines, pointer, `Expected ${shape}`));
}

function isPointerIntoAnswer(pointer: string): boolean {
  return pointer !== '' && isJsonPointer(pointer);
}

function pointerIssues(lines: SourceLines, pointers: readonly (readonly [string, string | undefined])[]) {
  return pointers
    .filter(([, pointer]) => pointer !== undefined && !isPointerIntoAnswer(pointer))
    .map(([place]) => issueAt(lines, place, pointerWords));
}

function waitIssues(lines: SourceLines, written: string | undefined): readonly DocumentIssue[] {
  if (written === undefined) {
    return [];
  }
  const reading = readDuration(written);
  const inBounds =
    'milliseconds' in reading &&
    reading.milliseconds >= replyWaitBounds.leastMs &&
    reading.milliseconds <= replyWaitBounds.mostMs;
  return inBounds ? [] : [issueAt(lines, placeOf('replies', 'wait'), waitWords)];
}

function deliveryIssues({ deliver }: WrittenRoute, place: TemplatePlace): readonly DocumentIssue[] {
  const { lines } = place;
  return [
    ...nameIssues(lines, [[placeOf('deliver', 'server'), deliver.server]], isServerName, serverNameShape),
    ...nameIssues(lines, [[placeOf('deliver', 'tool'), deliver.tool]], isToolName, toolNameShape),
    ...templatesIssues(deliveryTemplates, deliver.with, { ...place, pointer: placeOf('deliver', 'with') }),
    ...pointerIssues(lines, [
      [placeOf('deliver', 'sent', 'conversation'), deliver.sent?.conversation],
      [placeOf('deliver', 'sent', 'id'), deliver.sent?.id],
    ]),
  ];
}

function readArgumentIssues(replies: Replies, place: TemplatePlace): readonly DocumentIssue[] {
  const pointer = placeOf('replies', 'with');
  const written = templatesIssues(readingTemplates, replies.with, { ...place, pointer });
  if (written.length > 0) {
    return written;
  }
  return Result.match(renderedArguments(replies.with, readingTemplates.sample, place.clock), {
    onSuccess: () => [],
    onFailure: (failure) => [
      issueAt(
        place.lines,
        failure.reason === 'too_large' ? pointer : `${pointer}/${failure.argument}`,
        argumentsFailureWords(failure, 'the read over a sample reading'),
      ),
    ],
  });
}

function readingIssues(replies: Replies, place: TemplatePlace): readonly DocumentIssue[] {
  const { lines } = place;
  const { read, tell } = replies;
  return [
    ...nameIssues(
      lines,
      [
        [placeOf('replies', 'tool'), replies.tool],
        [placeOf('replies', 'tell', 'tool'), tell?.tool],
      ],
      isToolName,
      toolNameShape,
    ),
    ...templateIssues(conversationTemplates, replies.conversation ?? '', {
      ...place,
      pointer: placeOf('replies', 'conversation'),
    }),
    ...readArgumentIssues(replies, place),
    ...templatesIssues(tellingTemplates, tell?.with ?? {}, { ...place, pointer: placeOf('replies', 'tell', 'with') }),
    ...pointerIssues(lines, [
      [placeOf('replies', 'read', 'list'), read.list],
      [placeOf('replies', 'read', 'each', 'id'), read.each.id],
      [placeOf('replies', 'read', 'each', 'sender'), read.each.sender],
      [placeOf('replies', 'read', 'each', 'text'), read.each.text],
      [placeOf('replies', 'read', 'each', 'to'), read.each.to],
    ]),
    ...waitIssues(lines, replies.wait),
  ];
}

export function compiledToolBlock(
  written: WrittenRoute,
  { lines, clock }: DocumentReading,
  inputSchema: Schema.JsonObject | undefined,
): Result.Result<WrittenRoute, readonly DocumentIssue[]> {
  const place = { lines, pointer: '', inputSchema, clock };
  const issues = [
    ...deliveryIssues(written, place),
    ...(written.replies === undefined ? [] : readingIssues(written.replies, place)),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(written);
}

function isOversized(failure: ArgumentsFailure): boolean {
  return failure.reason === 'too_large' || failure.failure.reason === 'too_long';
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
