import { isBoundedPart } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { Part } from '../rendering/answer-buttons.ts';
import type { Intake } from '../replies/reply-intake.ts';
import { clickIdentity, type KeptRequest, type Reply } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import type { DeliveryParts } from '../schedule/delivery-parts.ts';
import type { NamedRequest, PlaceOfTheReplies } from '../wakes/named-requests.ts';

export interface DeliveredClick {
  readonly id: string;
  readonly sender: string;
  readonly to: string;
  readonly action: string;
  readonly time: number;
}

export interface DeliveredClicks extends PlaceOfTheReplies {
  readonly clicks: readonly DeliveredClick[];
}

export type ClickOutcome = 'taken' | 'refused' | 'passed_over' | 'unrecorded';

export type ClickBecause = 'no_request' | 'closed' | 'unknown_button' | 'seen';

export interface PerformedClick {
  readonly id: string;
  readonly outcome: ClickOutcome;
  readonly because?: ClickBecause;
}

export type ClickDelivery = (delivered: DeliveredClicks, now: number) => Effect.Effect<readonly PerformedClick[]>;

export interface Delivery {
  readonly parts: DeliveryParts;
  readonly delivered: DeliveredClicks;
  readonly named: readonly NamedRequest[];
  readonly hold: Pick<Intake, 'roomForATelling' | 'heldUntil'>;
}

export interface Clicked {
  readonly request: KeptRequest;
  readonly click: DeliveredClick;
  readonly sets: readonly Part[];
}

export function isWhole({ id, sender }: DeliveredClick): boolean {
  return isBoundedPart(id) && isBoundedPart(sender);
}

function byTimeThenId(one: DeliveredClick, other: DeliveredClick): number {
  const sooner = one.time - other.time;
  return sooner === 0 ? Number(one.id > other.id) - Number(one.id < other.id) : sooner;
}

export function oldestFirst(clicks: readonly DeliveredClick[]): readonly DeliveredClick[] {
  const once = clicks.filter((click, index) => clicks.findIndex(({ id }) => id === click.id) === index);
  return once.toSorted(byTimeThenId);
}

export function replyOf(request: KeptRequest, { id, sender }: DeliveredClick): Reply {
  return { id: clickIdentity(id), sender, text: undefined, to: request.sent.id, olderThan: [] };
}

export function intakeOf({ parts, delivered, named, hold }: Delivery, request: KeptRequest): Intake {
  const route = routeOfRequest(request);
  return {
    parts,
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
