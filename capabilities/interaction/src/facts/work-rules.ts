import type { RecordedWork, WorkRule } from '@on.auto/definitions';
import { Conflict } from '@on.auto/operations';

import { interactionFactOf, type DeliveryEvent } from './run-facts.ts';

export interface InteractionWork {
  readonly lastAttempt: number;
  readonly inFlight: number | null;
  readonly deliveredAt: string | null;
  readonly refusedReplies: readonly string[];
}

const nothingWorked: InteractionWork = { lastAttempt: 0, inFlight: null, deliveredAt: null, refusedReplies: [] };

function workedAfter(work: InteractionWork, recorded: RecordedWork): InteractionWork {
  const fact = interactionFactOf(recorded);
  if (fact?.type === 'delivery_started') {
    return { ...work, lastAttempt: fact.data.number, inFlight: fact.data.number };
  }
  if (fact?.type === 'reply_refused') {
    return { ...work, refusedReplies: [...work.refusedReplies, fact.data.reply.id] };
  }
  if (fact === undefined) {
    return work;
  }
  const ended = { ...work, inFlight: null };
  return fact.type === 'delivery_succeeded' ? { ...ended, deliveredAt: recorded.context.at } : ended;
}

export function interactionWorkOf(work: readonly RecordedWork[]): InteractionWork {
  return work.reduce((worked, recorded) => workedAfter(worked, recorded), nothingWorked);
}

const beingCancelled = new Conflict({ detail: 'The run is being cancelled, so it starts no more deliveries' });

const answeredBeforeDelivery = new Conflict({
  detail: 'The request was answered, so it starts no more deliveries',
});

function startRefusal(lastAttempt: number, number: number): Conflict | undefined {
  const next = lastAttempt + 1;
  return number === next
    ? undefined
    : new Conflict({
        detail: `The run records its delivery attempts in order, and attempt ${number} is not its next, ${next}; another attempt recorded it first`,
      });
}

function endRefusal(inFlight: number | null, number: number): Conflict | undefined {
  return inFlight === number
    ? undefined
    : new Conflict({
        detail: `Delivery ${number} is not the attempt of the run in flight, so it cannot end; another attempt ended it, or it never started`,
      });
}

export function deliveryRule({ type, data }: DeliveryEvent): WorkRule {
  return ({ cancel, answer, work }) => {
    const { lastAttempt, inFlight } = interactionWorkOf(work);
    if (type !== 'delivery_started') {
      return endRefusal(inFlight, data.number);
    }
    if (cancel !== undefined) {
      return beingCancelled;
    }
    return answer === null ? startRefusal(lastAttempt, data.number) : answeredBeforeDelivery;
  };
}

export const replyBounds = { refusals: 10 } as const;

const replySeen = new Conflict({ detail: 'The run has taken or refused this reply already, so it records it once' });

const answeredAlready = new Conflict({ detail: 'The run took an answer already, so it takes no further reply' });

const refusedEnough = new Conflict({
  detail: `The run has refused ${replyBounds.refusals} replies, the most it records, so it records no more`,
});

const refusedWhileCancelling = new Conflict({
  detail: 'The run is being cancelled, so it records no refused reply and tells the party nothing',
});

export function replyRule(replyId: string, refusing: boolean): WorkRule {
  return ({ cancel, answer, work }) => {
    const { refusedReplies } = interactionWorkOf(work);
    if (refusedReplies.includes(replyId) || answer?.reply?.id === replyId) {
      return replySeen;
    }
    if (answer !== null) {
      return answeredAlready;
    }
    if (refusing && cancel !== undefined) {
      return refusedWhileCancelling;
    }
    return refusing && refusedReplies.length >= replyBounds.refusals ? refusedEnough : undefined;
  };
}
