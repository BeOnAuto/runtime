import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import {
  argumentsFailureWords,
  nameIssues,
  placeOf,
  pointerIssues,
  renderedArguments,
  templateIssues,
  templatesIssues,
  type DocumentReading,
  type TemplatePlace,
} from '@on.auto/definitions/tool-blocks';
import { isServerName, isToolName, serverNameShape, toolNameShape } from '@on.auto/tool-servers/policy';
import { readDuration } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import { conversationTemplates, deliveryTemplates, readingTemplates, tellingTemplates } from './template-sets.ts';
import type { DeliverBlock, Replies } from './tool-block-schemas.ts';

export interface WrittenRoute {
  readonly deliver: DeliverBlock;
  readonly replies?: Replies | undefined;
}

const replyWaitBounds = { leastMs: 5000, mostMs: 3_600_000 } as const;

const waitWords = 'Expected an ISO 8601 duration from PT5S to PT1H, such as PT1M';

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
