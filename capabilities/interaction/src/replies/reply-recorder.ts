import { runCorrelationIn, type RecordedWorkAt, type Work } from '@on.auto/definitions';
import type { Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ConversationParts, ConversationPlace } from '../conversations/conversation-parts.ts';
import { replyRule } from '../facts/work-rules.ts';
import { recordedWork } from '../schedule/request-ledger.ts';
import type { KeptRequest, Reply } from './reply-taking.ts';

export interface ReplyPlace {
  readonly parts: ConversationParts;
  readonly place: ConversationPlace;
}

export interface RecordedReply extends RecordedWorkAt {
  readonly correlationId: string;
}

export function recordedReplyWork(
  { parts, place }: ReplyPlace,
  request: KeptRequest,
  reply: Reply,
  work: Work,
): Effect.Effect<RecordedReply | undefined, Unavailable> {
  const address = { ...place.playbook, id: request.runId };
  const rule = replyRule(reply.id, work.type === 'work');
  return Effect.flatMap(runCorrelationIn(parts.ledger, address), (correlationId) =>
    recordedWork(parts.record, address, { work, rule }, { causationId: place.row.last_fact, correlationId }).pipe(
      Effect.map((made) => (made === undefined ? undefined : { id: made.id, at: made.at, correlationId })),
    ),
  );
}
