import { recordedRunIn } from '@on.auto/definitions';
import { Effect } from 'effect';

import { roomForACall, turnBounds } from '../readings/turn-readings.ts';
import { mayAnswer } from '../replies/reply-taking.ts';
import { requestRecordOf } from '../run/request-record.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { requestsNamed } from '../wakes/named-requests.ts';
import { isOpen, refusedClick, settled } from './click-answers.ts';
import {
  isWhole,
  oldestFirst,
  type ClickBecause,
  type ClickDelivery,
  type ClickOutcome,
  type DeliveredClick,
  type Delivery,
  type PerformedClick,
} from './click-intake.ts';
import { unknownButtonRecorded } from './click-parts.ts';

interface Verdict {
  readonly outcome: ClickOutcome;
  readonly because?: ClickBecause;
}

const noRequest: Verdict = { outcome: 'passed_over', because: 'no_request' };

const closed: Verdict = { outcome: 'passed_over', because: 'closed' };

const unknownButton: Verdict = { outcome: 'passed_over', because: 'unknown_button' };

function verdictOf(outcome: ClickOutcome): Verdict {
  return outcome === 'passed_over' ? { outcome, because: 'seen' } : { outcome };
}

function performedClick(delivery: Delivery, click: DeliveredClick): Effect.Effect<Verdict> {
  const found = isWhole(click) ? delivery.named.find(({ request }) => request.sent.id === click.to) : undefined;
  if (found === undefined) {
    return Effect.succeed(noRequest);
  }
  const { request } = found;
  const address = { ...delivery.delivered.playbook, id: request.runId };
  return Effect.gen(function* () {
    const run = yield* recordedRunIn(delivery.parts.ledger, address);
    const sets = requestRecordOf(run?.run.record)?.buttons?.[click.action];
    if (!isOpen(run)) {
      return closed;
    }
    if (sets === undefined) {
      yield* unknownButtonRecorded(delivery, { request, click });
      return unknownButton;
    }
    const clicked = { request, click, sets };
    return verdictOf(
      mayAnswer(request, { sender: click.sender, to: request.sent.id })
        ? yield* settled(delivery, clicked)
        : yield* refusedClick(delivery, clicked),
    );
  });
}

export function clickDelivery(parts: DeliveryParts): ClickDelivery {
  return (delivered, now) =>
    Effect.gen(function* () {
      const clicks = oldestFirst(delivered.clicks);
      const named = yield* requestsNamed(
        parts,
        delivered,
        clicks.filter((click) => isWhole(click)).map(({ to }) => to),
        'click',
      );
      const hold = { roomForATelling: roomForACall(now), heldUntil: now + turnBounds.holdMs };
      const delivery = { parts, delivered, named, hold };
      return yield* Effect.forEach(clicks, (click) =>
        Effect.map(performedClick(delivery, click), (verdict): PerformedClick => ({ id: click.id, ...verdict })),
      );
    });
}
