import {
  isRequestRecord,
  runEventOf,
  takesAnAnswer,
  type RecordedRunEvent,
  type RecordedRunFact,
  type RunEvent,
} from '@on.auto/definitions';
import type { KeyedProjection, ProjectedMessage, ProjectedRow, ProjectedStream, RunContext } from '@on.auto/operations';
import { conversationCallsKind } from '@on.auto/tool-servers';
import type { Schema } from 'effect';

import { conversationKeyOf } from '../conversations/conversation-keys.ts';
import { interactionFactOf, saidOfARefusal, type RecordedFactNamed } from '../facts/run-facts.ts';
import { attemptSchedule, nextAttemptAt } from '../schedule/attempt-schedule.ts';
import {
  runOfATelling,
  tellingStartedOf,
  toldAllThatWasDue,
  toldOfTheAnswer,
  toldOfTheEnd,
} from '../tellings/told-rows.ts';
import { requestColumns, requestIndexes } from './request-columns.ts';
import {
  attemptDueAtOf,
  deliveryOf,
  endingDueAtOf,
  requestRowOf,
  settlementDueOf,
  tellingOf,
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
    reading: null,
    sent_conversation: null,
    sent_id: null,
    sent_at: null,
    answerer: request.answerer ?? null,
    reply: jsonOf(request.reply),
    reply_refusals: 0,
    refusals_told: 0,
    tell: tellingOf(request),
    taken: null,
    telling_due_at: null,
    last_said: null,
    ending: null,
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

function keptConversation({ data, context }: Delivery<'delivery_succeeded'>) {
  const { delivered_as: deliveredAs, replies_in: repliesIn } = data;
  const sentAt = Date.parse(context.at);
  return {
    ...(deliveredAs === undefined
      ? {}
      : { sent_conversation: deliveredAs.conversation, sent_id: deliveredAs.id, sent_at: sentAt }),
    ...(repliesIn === undefined
      ? {}
      : { conversation: conversationKeyOf(repliesIn), reading: repliesIn.reading ?? null }),
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
    const { told, because, issues } = fact.data;
    return rowOf({
      ...row,
      reply_refusals: row.reply_refusals + 1,
      refusals_told: row.refusals_told + (told ? 1 : 0),
      last_said: told ? saidOfARefusal(because, issues) : row.last_said,
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
  { id }: ProjectedMessage,
): ProjectedRow | undefined {
  const ended = endingOf(fact);
  const told = toldOfTheEnd(row, ended, id, fact.context.at);
  return row.ended === null ? rowOf({ ...row, open: false, next_attempt_at: null, ended, ...told }) : undefined;
}

function answered(row: OpenRequestRow, fact: Fact<'request_answered'>, { id }: ProjectedMessage): ProjectedRow {
  return rowOf({
    ...row,
    open: false,
    next_attempt_at: null,
    standing: standingUnlessDecided(row, 'answered'),
    ...toldOfTheAnswer(row, fact, id),
  });
}

function changed(row: OpenRequestRow, fact: RecordedRunEvent, message: ProjectedMessage): ProjectedRow | undefined {
  if (fact.type === 'run_cancel_requested') {
    return row.open && settlementDueOf(row) === undefined ? rowOf({ ...row, standing: 'cancelling' }) : undefined;
  }
  if (fact.type === 'request_answered') {
    return answered(row, fact, message);
  }
  if (fact.type === 'work') {
    return worked(row, message);
  }
  return fact.type === 'run_succeeded' || fact.type === 'run_rejected' || fact.type === 'run_failed'
    ? closed(row, fact, message)
    : undefined;
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = runEventOf(message);
  if (fact?.type === 'run_deferred') {
    return requested(fact, message);
  }
  const kept = requestRowOf(row);
  if (kept === undefined || fact === undefined) {
    return undefined;
  }
  const telling = tellingStartedOf(message);
  if (telling !== undefined) {
    return toldAllThatWasDue(kept, telling) ? rowOf({ ...kept, telling_due_at: null }) : undefined;
  }
  return changed(kept, fact, message);
}

function keyOf(message: ProjectedMessage, { kind, id }: ProjectedStream): string | undefined {
  return kind === conversationCallsKind ? runOfATelling(message) : id;
}

export const openRequests: KeyedProjection = {
  name: openRequestsName,
  version: 17,
  kinds: ['runs', conversationCallsKind],
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
    'telling_started',
  ],
  columns: requestColumns,
  indexes: requestIndexes,
  keyOf,
  advanced: [
    { column: 'telling_due_at', setBy: ['run_deferred', 'request_answered', 'run_rejected', 'telling_started'] },
  ],
  rowAfter,
};
