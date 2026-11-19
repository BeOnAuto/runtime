import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import {
  argumentsFailureWords,
  isOversized,
  nameIssues,
  placeOf,
  pointerIssues,
  renderedArguments,
  smallerTemplatesRemedy,
  templateIssues,
  templatesIssues,
  type ArgumentsFailure,
  type DocumentReading,
  type TemplatePlace,
  type Templates,
} from '@on.auto/definitions/tool-blocks';
import { isServerName, isToolName, serverNameShape, toolNameShape } from '@on.auto/tool-servers/policy';
import { readDuration } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import { readsVariable } from './rendered-reads.ts';
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
  const reads = readsVariable(deliver.with, 'rendered');
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

interface SampleRead {
  readonly place: TemplatePlace;
  readonly mostBytes: number;
  readonly reported: (failure: ArgumentsFailure) => boolean;
}

const readArguments = placeOf('replies', 'with');

function sampleReadIssues(templates: Templates, { place, mostBytes, reported }: SampleRead) {
  return Result.match(renderedArguments(templates, readingTemplates.sample, place.clock, mostBytes), {
    onSuccess: (): readonly DocumentIssue[] => [],
    onFailure: (failure): readonly DocumentIssue[] =>
      reported(failure)
        ? [
            issueAt(
              place.lines,
              failure.reason === 'too_large' ? readArguments : `${readArguments}/${failure.argument}`,
              argumentsFailureWords(failure, 'the read over a sample reading', smallerTemplatesRemedy),
            ),
          ]
        : [],
  });
}

function everyFailure(): boolean {
  return true;
}

function readingNoInput(templates: Templates): Templates {
  return Object.fromEntries(
    Object.entries(templates).filter(([, value]: readonly [string, Schema.Json]) => !readsVariable(value, 'input')),
  );
}

function readArgumentIssues(replies: Replies, place: TemplatePlace, mostBytes: number): readonly DocumentIssue[] {
  const written = templatesIssues(readingTemplates, replies.with, { ...place, pointer: readArguments });
  if (written.length > 0) {
    return written;
  }
  const withoutInput = readingNoInput(replies.with);
  const issues = sampleReadIssues(withoutInput, { place, mostBytes, reported: everyFailure });
  const readsTheInput = Object.keys(withoutInput).length < Object.keys(replies.with).length;
  return issues.length > 0 || !readsTheInput
    ? issues
    : sampleReadIssues(replies.with, { place, mostBytes, reported: isOversized });
}

const wholeAnswer = '';

function listPointerOf({ list }: Replies['read']): string | undefined {
  return list === wholeAnswer ? undefined : list;
}

function readingIssues(replies: Replies, place: TemplatePlace, mostBytes: number): readonly DocumentIssue[] {
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
    ...readArgumentIssues(replies, place, mostBytes),
    ...templatesIssues(tellingTemplates, tell?.with ?? {}, { ...place, pointer: placeOf('replies', 'tell', 'with') }),
    ...pointerIssues(lines, [
      [placeOf('replies', 'read', 'list'), listPointerOf(read)],
      [placeOf('replies', 'read', 'each', 'id'), read.each.id],
      [placeOf('replies', 'read', 'each', 'sender'), read.each.sender],
      [placeOf('replies', 'read', 'each', 'text'), read.each.text],
      [placeOf('replies', 'read', 'each', 'to'), read.each.to],
      [placeOf('replies', 'read', 'each', 'time'), read.each.time],
      [placeOf('replies', 'tell', 'sent'), tell?.sent],
    ]),
    ...waitIssues(lines, replies.wait),
  ];
}

export function compiledToolBlock(
  written: WrittenRoute,
  { lines, clock, mostRequestBytesTo }: DocumentReading,
  inputSchema: Schema.JsonObject | undefined,
  renders: boolean,
): Result.Result<WrittenRoute, readonly DocumentIssue[]> {
  const place = { lines, pointer: '', inputSchema, clock };
  const mostBytes = mostRequestBytesTo(written.deliver.server);
  const issues = [
    ...deliveryIssues(written, place, renders),
    ...(written.replies === undefined ? [] : readingIssues(written.replies, place, mostBytes)),
  ];
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(written);
}
