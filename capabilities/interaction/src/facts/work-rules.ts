import type { RecordedWork, WorkRule } from '@on.auto/definitions';
import { Conflict } from '@on.auto/operations';

import { interactionFactOf, type DeliveryEvent, type ReplyRefusal } from './run-facts.ts';

export interface InteractionWork {
  readonly lastAttempt: number;
  readonly inFlight: number | null;
  readonly deliveredAt: string | null;
  readonly refusedReplies: readonly string[];
  readonly refusedOthers: number;
}

const nothingWorked: InteractionWork = {
  lastAttempt: 0,
  inFlight: null,
  deliveredAt: null,
  refusedReplies: [],
  refusedOthers: 0,
};

function workedAfter(work: InteractionWork, recorded: RecordedWork): InteractionWork {
  const fact = interactionFactOf(recorded);
  if (fact?.type === 'delivery_started') {
    return { ...work, lastAttempt: fact.data.number, inFlight: fact.data.number };
  }
  if (fact?.type === 'reply_refused') {
    const fromAnother = fact.data.because === 'not_the_answerer' ? 1 : 0;
    return {
      ...work,
      refusedReplies: [...work.refusedReplies, fact.data.reply.id],
      refusedOthers: work.refusedOthers + fromAnother,
    };
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

const refusedAnotherAlready = new Conflict({
  detail: 'The run has refused the answer of someone it does not wait on already, so it records no more of them',
});

const refusedWhileCancelling = new Conflict({
  detail: 'The run is being cancelled, so it records no refused reply and tells the party nothing',
});

function refusalRefused(refusal: ReplyRefusal, cancelling: boolean, worked: InteractionWork): Conflict | undefined {
  if (cancelling) {
    return refusedWhileCancelling;
  }
  if (refusal === 'not_the_answerer' && worked.refusedOthers > 0) {
    return refusedAnotherAlready;
  }
  return worked.refusedReplies.length >= replyBounds.refusals ? refusedEnough : undefined;
}

export function replyRule(replyId: string, refusal?: ReplyRefusal): WorkRule {
  return ({ cancel, answer, work }) => {
    const worked = interactionWorkOf(work);
    if (worked.refusedReplies.includes(replyId) || answer?.reply?.id === replyId) {
      return replySeen;
    }
    if (answer !== null) {
      return answeredAlready;
    }
    return refusal === undefined ? undefined : refusalRefused(refusal, cancel !== undefined, worked);
  };
}
