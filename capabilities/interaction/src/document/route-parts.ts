import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { Result, type Schema } from 'effect';

import { compiledToolBlock, type DocumentReading, type WrittenRoute } from '../tool-blocks/compiled-tool-block.ts';
import { forAnAgent, type DeliverBlock } from '../tool-blocks/tool-block-schemas.ts';
import type { InteractionFrontMatter } from './front-matter.ts';
import type { RequestDocument } from './interaction-document.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export type WrittenWay = WrittenRoute | typeof forAnAgent | null;

export function wayOf(way: WrittenWay, lines: SourceLines): Pick<RequestDocument, 'route' | 'heldForAnAgent'> {
  if (way === null || way === forAnAgent) {
    return { heldForAnAgent: { said: way === forAnAgent, line: issueAt(lines, '/deliver', '').line } };
  }
  return { route: way };
}

const repliesNeedADelivery =
  "Only a function that delivers through a tool reads replies: deliver names a connection's tool that sends the request";

const agentReadsNoReplies =
  'A request for an agent is answered with answer_interaction, so it reads no replies; deliver through a tool to read them';

const notificationReadsNothing = 'A notification takes no answer, so it reads no replies';

const readingNeedsSent =
  'Reading replies needs deliver.sent, the pointers to the conversation and the identity of the message the tool sent';

function readingIssues(
  deliver: DeliverBlock,
  { output }: InteractionFrontMatter,
  lines: SourceLines,
): readonly DocumentIssue[] {
  return [
    ...(output?.schema === undefined ? [issueAt(lines, '/replies', notificationReadsNothing)] : []),
    ...(deliver.sent === undefined ? [issueAt(lines, '/replies', readingNeedsSent)] : []),
  ];
}

function wayWithoutATool(written: InteractionFrontMatter, lines: SourceLines): Checked<WrittenWay> {
  const way = written.deliver === forAnAgent ? forAnAgent : null;
  if (written.replies === undefined) {
    return Result.succeed(way);
  }
  return Result.fail([issueAt(lines, '/replies', way === null ? repliesNeedADelivery : agentReadsNoReplies)]);
}

export function routeIn(
  written: InteractionFrontMatter,
  reading: DocumentReading,
  inputSchema: Schema.JsonObject | undefined,
): Checked<WrittenWay> {
  const { lines } = reading;
  const { deliver, replies } = written;
  if (deliver === undefined || deliver === forAnAgent) {
    return wayWithoutATool(written, lines);
  }
  const shape = replies === undefined ? [] : readingIssues(deliver, written, lines);
  const compiled = compiledToolBlock({ deliver, replies }, reading, inputSchema);
  if (shape.length > 0) {
    return Result.fail([...shape, ...(Result.isFailure(compiled) ? compiled.failure : [])]);
  }
  return compiled;
}
