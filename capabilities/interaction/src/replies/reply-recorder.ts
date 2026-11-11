import { runCorrelationIn, type RecordWork, type RecordedWorkAt, type Work } from '@on.auto/definitions';
import type { PlaybookAddress, ProjectionReader, RecordedReader, StreamWriter, Unavailable } from '@on.auto/operations';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { replyRule } from '../facts/work-rules.ts';
import { recordedWork } from '../schedule/request-ledger.ts';
import type { KeptRequest, Reply } from './reply-taking.ts';

export interface IntakeParts {
  readonly ledger: StreamWriter & Pick<RecordedReader, 'readRecorded'> & Pick<ProjectionReader, 'readProjectedRows'>;
  readonly tools: Pick<ToolAccess, 'preparedCall'>;
  readonly record: RecordWork;
}

export interface ReplyPlace {
  readonly parts: IntakeParts;
  readonly playbook: PlaybookAddress;
  readonly causationId: string;
}

export interface RecordedReply extends RecordedWorkAt {
  readonly correlationId: string;
}

export function recordedReplyWork(
  { parts, playbook, causationId }: ReplyPlace,
  request: KeptRequest,
  reply: Reply,
  work: Work,
): Effect.Effect<RecordedReply | undefined, Unavailable> {
  const address = { ...playbook, id: request.runId };
  const rule = replyRule(reply.id, work.type === 'work');
  return Effect.flatMap(runCorrelationIn(parts.ledger, address), (correlationId) =>
    recordedWork(parts.record, address, { work, rule }, { causationId, correlationId }).pipe(
      Effect.map((made) => (made === undefined ? undefined : { id: made.id, at: made.at, correlationId })),
    ),
  );
}
