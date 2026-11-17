import { Effect } from 'effect';

import { isBoundedPart } from '../delivery/sent-messages.ts';
import { roomForACall, turnBounds } from '../readings/turn-readings.ts';
import { replyTaken, type Intake } from '../replies/reply-intake.ts';
import { nothingTaken, type IntakeState } from '../replies/reply-recording.ts';
import type { KeptRequest, Reply } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import { answersMarkRefused } from '../tellings/own-messages.ts';
import { requestsNamed, type NamedRequest, type PlaceOfTheReplies } from './named-requests.ts';

export interface DeliveredReply extends Reply {
  readonly to: string;
  readonly time: number;
}

export interface DeliveredReplies extends PlaceOfTheReplies {
  readonly replies: readonly DeliveredReply[];
}

export type ReplyOutcome = 'taken' | 'refused' | 'passed_over' | 'unrecorded';

export interface PerformedReply {
  readonly id: string;
  readonly outcome: ReplyOutcome;
  readonly markRefused?: { readonly runId: string };
}

export type ReplyDelivery = (delivered: DeliveredReplies, now: number) => Effect.Effect<readonly PerformedReply[]>;

function isWhole({ id, sender }: DeliveredReply): boolean {
  return isBoundedPart(id) && isBoundedPart(sender);
}

function byTimeThenId(one: DeliveredReply, other: DeliveredReply): number {
  const sooner = one.time - other.time;
  return sooner === 0 ? Number(one.id > other.id) - Number(one.id < other.id) : sooner;
}

function oldestFirst(replies: readonly DeliveredReply[]): readonly DeliveredReply[] {
  const once = replies.filter((reply, index) => replies.findIndex(({ id }) => id === reply.id) === index);
  return once.toSorted(byTimeThenId);
}

function stateCarried(named: readonly NamedRequest[]): IntakeState {
  const answered = named.filter((request) => request.answered);
  return {
    ...nothingTaken,
    answered: new Set(answered.map(({ request }) => request.runId)),
    answeredAndTold: new Set(answered.filter((request) => request.answeredAndTold).map(({ request }) => request.runId)),
  };
}

interface Pass {
  readonly state: IntakeState;
  readonly performed: readonly PerformedReply[];
}

interface Delivery {
  readonly parts: DeliveryParts;
  readonly delivered: DeliveredReplies;
  readonly named: readonly NamedRequest[];
  readonly hold: Pick<Intake, 'roomForATelling' | 'heldUntil'>;
}

function intakeOf({ parts, delivered, named, hold }: Delivery, request: KeptRequest): Intake {
  const route = routeOfRequest(request);
  return {
    parts,
    playbook: delivered.playbook,
    candidates: named.map((each) => each.request),
    arrival: {
      server: route.server,
      tool: route.replies.tool,
      conversation: delivered.conversation,
      causationId: request.row.request_id,
      delivered: true,
    },
    ...hold,
  };
}

function outcomeOf(before: IntakeState, after: IntakeState): ReplyOutcome {
  if (after.unrecorded) {
    return 'unrecorded';
  }
  if (after.taken > before.taken) {
    return 'taken';
  }
  return after.refused > before.refused ? 'refused' : 'passed_over';
}

function requestAnsweredBy({ named }: Delivery, reply: DeliveredReply): NamedRequest | undefined {
  const found = isWhole(reply) ? named.find(({ request }) => request.sent.id === reply.to) : undefined;
  return found?.seen(reply.id) === false ? found : undefined;
}

function performedAs(
  { parts, delivered }: Delivery,
  { runId }: KeptRequest,
  id: string,
  outcome: ReplyOutcome,
): Effect.Effect<PerformedReply> {
  if (outcome !== 'taken') {
    return Effect.succeed({ id, outcome });
  }
  return Effect.map(answersMarkRefused(parts.ledger, delivered.playbook, runId), (refused) =>
    refused ? { id, outcome, markRefused: { runId } } : { id, outcome },
  );
}

function performedOne(delivery: Delivery, { state, performed }: Pass, reply: DeliveredReply): Effect.Effect<Pass> {
  const found = requestAnsweredBy(delivery, reply);
  if (found === undefined) {
    return Effect.succeed({ state, performed: [...performed, { id: reply.id, outcome: 'passed_over' }] });
  }
  return Effect.gen(function* () {
    const after = yield* replyTaken(intakeOf(delivery, found.request), state, reply);
    const one = yield* performedAs(delivery, found.request, reply.id, outcomeOf(state, after));
    return { state: after, performed: [...performed, one] };
  });
}

export function replyDelivery(parts: DeliveryParts): ReplyDelivery {
  return (delivered, now) =>
    Effect.gen(function* () {
      const replies = oldestFirst(delivered.replies);
      const named = yield* requestsNamed(
        parts,
        delivered,
        replies.filter((reply) => isWhole(reply)).map(({ to }) => to),
      );
      const hold = { roomForATelling: roomForACall(now), heldUntil: now + turnBounds.holdMs };
      const delivery = { parts, delivered, named, hold };
      const carried: Pass = { state: stateCarried(named), performed: [] };
      const pass = yield* Effect.reduce(
        replies,
        () => carried,
        (soFar, reply) => performedOne(delivery, soFar, reply),
      );
      return pass.performed;
    });
}
