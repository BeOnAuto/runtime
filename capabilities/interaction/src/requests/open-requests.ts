import {
  isRequestRecord,
  runEventOf,
  takesAnAnswer,
  type RecordedRunEvent,
  type RecordedRunFact,
  type RunEvent,
} from '@on.auto/definitions';
import type { ProjectedMessage, ProjectedRow, KeyedProjection, RunContext } from '@on.auto/operations';
import type { Schema } from 'effect';

import { conversationKeyOf } from '../conversations/conversation-keys.ts';
import { interactionFactOf, type RecordedFactNamed } from '../facts/run-facts.ts';
import { attemptSchedule, nextAttemptAt } from '../schedule/attempt-schedule.ts';
import {
  attemptDueAtOf,
  deliveryOf,
  endingDueAtOf,
  requestRowOf,
  settlementDueOf,
  type OpenRequestRow,
  type UndueRequestRow,
} from './request-rows.ts';

export const openRequestsName = 'open_requests';

export const attemptInFlightMs = 60_000;

type Fact<Type extends RunEvent['type']> = RecordedRunFact<Type>;

type Delivery<Type extends 'delivery_succeeded' | 'delivery_failed' | 'delivery_refused'> = RecordedFactNamed<Type>;

function rowOf(row: UndueRequestRow): ProjectedRow {
  return { ...row, attempt_due_at: attemptDueAtOf(row), ending_due_at: endingDueAtOf(row) };
}

function functionOf({ definitionType, definitionName, definitionVersion }: RunContext) {
  return { type: definitionType, function: definitionName, version: definitionVersion };
}

function jsonOf(block: Schema.JsonObject | undefined): string | null {
  return block === undefined ? null : JSON.stringify(block);
}

function requested({ data, context }: Fact<'run_deferred'>, message: ProjectedMessage): ProjectedRow | undefined {
  const request = data.record;
  if (!isRequestRecord(request)) {
    return undefined;
  }
  const at = Date.parse(context.at);
  const delivery = deliveryOf(request.deliver);
  const forAnAgent = delivery === null;
  return rowOf({
    request_id: message.id,
    ...functionOf(context),
    party: request.to,
    delivery,
    replies: jsonOf(request.replies),
    message: request.message,
    answers: takesAnAnswer(request),
    answer_schema: request.answer_schema === undefined ? null : JSON.stringify(request.answer_schema),
    requested_at: at,
    expires_at: Date.parse(request.expires_at),
    attempts: 0,
    next_attempt_at: forAnAgent ? null : at,
    standing: forAnAgent ? 'held_for_an_agent' : 'to_deliver',
    open: true,
    ended: null,
    conversation: null,
    sent_conversation: null,
    sent_id: null,
    answerer: request.answerer ?? null,
    reply: jsonOf(request.reply),
    reply_refusals: 0,
    refusals_told: 0,
  });
}

function standingUnlessDecided(row: OpenRequestRow, standing: OpenRequestRow['standing']) {
  return row.standing === 'cancelling' || row.standing === 'answered' ? row.standing : standing;
}

function attemptStarted(row: OpenRequestRow, { data, context }: RecordedFactNamed<'delivery_started'>): ProjectedRow {
  return rowOf({
    ...row,
    attempts: data.number,
    next_attempt_at: Date.parse(context.at) + attemptInFlightMs,
    standing: standingUnlessDecided(row, 'delivering'),
  });
}

function nextAfter({ type, data, context }: Delivery<'delivery_failed' | 'delivery_refused'>): number | undefined {
  return type === 'delivery_failed' && data.number < attemptSchedule.attempts
    ? nextAttemptAt({ attempt: data.number, endedAt: Date.parse(context.at), retryAfterMs: data.retry_after_ms })
    : undefined;
}

function afterFailure(row: OpenRequestRow, fact: Delivery<'delivery_failed' | 'delivery_refused'>): UndueRequestRow {
  const next = nextAfter(fact);
  return next === undefined
    ? { ...row, next_attempt_at: null, standing: standingUnlessDecided(row, 'undelivered') }
    : { ...row, next_attempt_at: next, standing: standingUnlessDecided(row, 'retrying') };
}

function keptConversation({ data }: Delivery<'delivery_succeeded'>) {
  const { delivered_as: deliveredAs, replies_in: repliesIn } = data;
  return {
    ...(deliveredAs === undefined ? {} : { sent_conversation: deliveredAs.conversation, sent_id: deliveredAs.id }),
    ...(repliesIn === undefined ? {} : { conversation: conversationKeyOf(repliesIn) }),
  };
}

function attemptEnded(
  row: OpenRequestRow,
  fact: Delivery<'delivery_succeeded' | 'delivery_failed' | 'delivery_refused'>,
): ProjectedRow {
  if (fact.type === 'delivery_succeeded') {
    return rowOf({
      ...row,
      ...keptConversation(fact),
      next_attempt_at: null,
      standing: standingUnlessDecided(row, 'delivered'),
    });
  }
  return rowOf(afterFailure(row, fact));
}

function worked(row: OpenRequestRow, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = interactionFactOf(message);
  if (fact === undefined) {
    return undefined;
  }
  if (fact.type === 'delivery_started') {
    return attemptStarted(row, fact);
  }
  if (fact.type === 'reply_refused') {
    return rowOf({
      ...row,
      reply_refusals: row.reply_refusals + 1,
      refusals_told: row.refusals_told + (fact.data.told ? 1 : 0),
    });
  }
  return attemptEnded(row, fact);
}

function endingOf(fact: Fact<'run_succeeded' | 'run_rejected' | 'run_failed'>): string {
  if (fact.type === 'run_succeeded') {
    return 'answered';
  }
  if (fact.type === 'run_failed') {
    return 'failed';
  }
  const { rejection } = fact.data;
  return rejection.reason === 'unanswered' ? rejection.kind : rejection.reason;
}

function closed(
  row: OpenRequestRow,
  fact: Fact<'run_succeeded' | 'run_rejected' | 'run_failed'>,
): ProjectedRow | undefined {
  return row.ended === null ? rowOf({ ...row, open: false, next_attempt_at: null, ended: endingOf(fact) }) : undefined;
}

function answered(row: OpenRequestRow): ProjectedRow {
  return rowOf({ ...row, open: false, next_attempt_at: null, standing: standingUnlessDecided(row, 'answered') });
}

function changed(row: OpenRequestRow, fact: RecordedRunEvent, message: ProjectedMessage): ProjectedRow | undefined {
  if (fact.type === 'run_cancel_requested') {
    return row.open && settlementDueOf(row) === undefined ? rowOf({ ...row, standing: 'cancelling' }) : undefined;
  }
  if (fact.type === 'request_answered') {
    return answered(row);
  }
  if (fact.type === 'work') {
    return worked(row, message);
  }
  return fact.type === 'run_succeeded' || fact.type === 'run_rejected' || fact.type === 'run_failed'
    ? closed(row, fact)
    : undefined;
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = runEventOf(message);
  if (fact?.type === 'run_deferred') {
    return requested(fact, message);
  }
  const kept = requestRowOf(row);
  return kept === undefined || fact === undefined ? undefined : changed(kept, fact, message);
}

export const openRequests: KeyedProjection = {
  name: openRequestsName,
  version: 8,
  kinds: ['runs'],
  types: [
    'run_deferred',
    'delivery_started',
    'delivery_succeeded',
    'delivery_failed',
    'delivery_refused',
    'request_answered',
    'reply_refused',
    'run_cancel_requested',
    'run_succeeded',
    'run_rejected',
    'run_failed',
  ],
  columns: [
    { name: 'request_id', kind: 'text' },
    { name: 'type', kind: 'text' },
    { name: 'function', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'party', kind: 'text' },
    { name: 'delivery', kind: 'text' },
    { name: 'replies', kind: 'text' },
    { name: 'message', kind: 'text' },
    { name: 'answers', kind: 'boolean' },
    { name: 'answer_schema', kind: 'text' },
    { name: 'requested_at', kind: 'integer' },
    { name: 'expires_at', kind: 'integer' },
    { name: 'attempts', kind: 'integer' },
    { name: 'next_attempt_at', kind: 'integer' },
    { name: 'standing', kind: 'text' },
    { name: 'open', kind: 'boolean' },
    { name: 'attempt_due_at', kind: 'integer' },
    { name: 'ending_due_at', kind: 'integer' },
    { name: 'ended', kind: 'text' },
    { name: 'conversation', kind: 'text' },
    { name: 'sent_conversation', kind: 'text' },
    { name: 'sent_id', kind: 'text' },
    { name: 'answerer', kind: 'text' },
    { name: 'reply', kind: 'text' },
    { name: 'reply_refusals', kind: 'integer' },
    { name: 'refusals_told', kind: 'integer' },
  ],
  indexes: [
    { name: 'by_open', columns: ['open', 'requested_at', 'row_key'] },
    { name: 'by_party', columns: ['open', 'party', 'requested_at', 'row_key'] },
    { name: 'by_function', columns: ['open', 'function', 'requested_at', 'row_key'] },
    { name: 'by_type', columns: ['open', 'type', 'requested_at', 'row_key'] },
    { name: 'by_conversation', columns: ['open', 'conversation', 'requested_at', 'row_key'] },
    { name: 'attempts_due', columns: ['attempt_due_at'], acrossPlaybooks: true, whereSet: 'attempt_due_at' },
    { name: 'endings_due', columns: ['ending_due_at'], acrossPlaybooks: true, whereSet: 'ending_due_at' },
  ],
  rowAfter,
};
