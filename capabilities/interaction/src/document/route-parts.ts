import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { Result, type Schema } from 'effect';

import { compiledToolBlock, type DocumentReading, type WrittenRoute } from '../tool-blocks/compiled-tool-block.ts';
import type { InteractionFrontMatter } from './front-matter.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

const inboxReadsNothing =
  'Only a function that delivers through a tool reads replies; a function without deliver waits in the inbox';

const notificationReadsNothing = 'A notification takes no answer, so it reads no replies';

const readingNeedsSent =
  'Reading replies needs deliver.sent, the pointers to the conversation and the identity of the message the tool sent';

function readingIssues({ deliver, output }: InteractionFrontMatter, lines: SourceLines): readonly DocumentIssue[] {
  return [
    ...(output?.schema === undefined ? [issueAt(lines, '/replies', notificationReadsNothing)] : []),
    ...(deliver?.sent === undefined ? [issueAt(lines, '/replies', readingNeedsSent)] : []),
  ];
}

export function routeIn(
  written: InteractionFrontMatter,
  reading: DocumentReading,
  inputSchema: Schema.JsonObject | undefined,
): Checked<WrittenRoute | null> {
  const { lines } = reading;
  const { deliver, replies } = written;
  if (deliver === undefined) {
    return replies === undefined ? Result.succeed(null) : Result.fail([issueAt(lines, '/replies', inboxReadsNothing)]);
  }
  const shape = replies === undefined ? [] : readingIssues(written, lines);
  const compiled = compiledToolBlock({ deliver, replies }, reading, inputSchema);
  if (shape.length > 0) {
    return Result.fail([...shape, ...(Result.isFailure(compiled) ? compiled.failure : [])]);
  }
  return compiled;
}
