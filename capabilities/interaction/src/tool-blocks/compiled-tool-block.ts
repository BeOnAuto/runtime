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

import { readsRendered } from './rendered-reads.ts';
import {
  conversationKeyTemplates,
  deliveryTemplates,
  readingTemplates,
  renderedDeliveryTemplates,
  tellingTemplates,
} from './template-sets.ts';
import { tellBlockOf, type DeliverBlock, type Replies } from './tool-block-schemas.ts';

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

const needsRendered =
  "A request with render sends the message it renders, so deliver.with reads rendered somewhere; write for example blocks: '{{ rendered }}'";

const needsRender =
  'rendered is the message a request with render builds, so a function that reads it writes render: slack in its front matter';

function deliveryTemplateIssues(
  { deliver }: WrittenRoute,
  place: TemplatePlace,
  renders: boolean,
): readonly DocumentIssue[] {
  const pointer = placeOf('deliver', 'with');
  const reads = readsRendered(deliver.with);
  if (renders) {
    return [
      ...(reads ? [] : [issueAt(place.lines, pointer, needsRendered)]),
      ...templatesIssues(renderedDeliveryTemplates, deliver.with, { ...place, pointer }),
    ];
  }
  return reads
    ? [issueAt(place.lines, pointer, needsRender)]
    : templatesIssues(deliveryTemplates, deliver.with, { ...place, pointer });
}

function deliveryIssues(written: WrittenRoute, place: TemplatePlace, renders: boolean): readonly DocumentIssue[] {
  const { lines } = place;
  const { deliver } = written;
  return [
    ...nameIssues(lines, [[placeOf('deliver', 'server'), deliver.server]], isServerName, serverNameShape),
    ...nameIssues(lines, [[placeOf('deliver', 'tool'), deliver.tool]], isToolName, toolNameShape),
    ...deliveryTemplateIssues(written, place, renders),
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
  const { read } = replies;
  const tell = tellBlockOf(replies);
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
    ...templateIssues(conversationKeyTemplates, replies.conversation ?? '', {
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
      [placeOf('replies', 'tell', 'sent'), tell?.sent],
    ]),
    ...waitIssues(lines, replies.wait),
  ];
}

export function compiledToolBlock(
  written: WrittenRoute,
  { lines, clock }: DocumentReading,
  inputSchema: Schema.JsonObject | undefined,
  renders: boolean,
): Result.Result<WrittenRoute, readonly DocumentIssue[]> {
  const place = { lines, pointer: '', inputSchema, clock };
  const issues = [
    ...deliveryIssues(written, place, renders),
    ...(written.replies === undefined ? [] : readingIssues(written.replies, place)),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(written);
}
