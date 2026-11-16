import { runCorrelationIn, type RecordedWorkAt, type Work } from '@on.auto/definitions';
import type { PlaybookAddress, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ReplyRefusal } from '../facts/run-facts.ts';
import { replyRule } from '../facts/work-rules.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { recordedWork } from '../schedule/request-ledger.ts';
import type { KeptRequest, Reply } from './reply-taking.ts';

export interface ReplyPlace {
  readonly parts: DeliveryParts;
  readonly playbook: PlaybookAddress;
  readonly causationId: string;
}

export interface RecordedReply extends RecordedWorkAt {
  readonly correlationId: string;
}

export interface ReplyWork {
  readonly work: Work;
  readonly refusal?: ReplyRefusal;
}

export function recordedReplyWork(
  { parts, playbook, causationId }: ReplyPlace,
  request: KeptRequest,
  reply: Reply,
  { work, refusal }: ReplyWork,
): Effect.Effect<RecordedReply | undefined, Unavailable> {
  const address = { ...playbook, id: request.runId };
  const rule = replyRule(reply.id, refusal);
  return Effect.flatMap(runCorrelationIn(parts.ledger, address), (correlationId) =>
    recordedWork(parts.record, address, { work, rule }, { causationId, correlationId }).pipe(
      Effect.map((made) => (made === undefined ? undefined : { id: made.id, at: made.at, correlationId })),
    ),
  );
}
