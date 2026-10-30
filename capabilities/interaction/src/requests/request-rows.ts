import type { ProjectedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { interactionType } from '../capability/interaction-type.ts';
import { routeOf, type Route } from '../tool-blocks/routes.ts';

export const StandingSchema = Schema.Literals([
  'in_inbox',
  'to_deliver',
  'delivering',
  'delivered',
  'retrying',
  'undelivered',
  'answered',
  'cancelling',
]);

const OpenRequestRowSchema = Schema.Struct({
  request_id: Schema.String,
  type: Schema.String,
  function: Schema.String,
  version: Schema.Int,
  party: Schema.String,
  delivery: Schema.NullOr(Schema.String),
  replies: Schema.NullOr(Schema.String),
  message: Schema.String,
  answers: Schema.Boolean,
  answer_schema: Schema.NullOr(Schema.String),
  requested_at: Schema.Int,
  expires_at: Schema.Int,
  attempts: Schema.Int,
  next_attempt_at: Schema.NullOr(Schema.Int),
  standing: StandingSchema,
  open: Schema.Boolean,
  attempt_due_at: Schema.NullOr(Schema.Int),
  ending_due_at: Schema.NullOr(Schema.Int),
  ended: Schema.NullOr(Schema.String),
  conversation: Schema.NullOr(Schema.String),
  sent_conversation: Schema.NullOr(Schema.String),
  sent_id: Schema.NullOr(Schema.String),
  answerer: Schema.NullOr(Schema.String),
  reply: Schema.NullOr(Schema.String),
  reply_refusals: Schema.Int,
  refusals_told: Schema.Int,
});

export type OpenRequestRow = typeof OpenRequestRowSchema.Type;

const decodeRow = Schema.decodeUnknownOption(OpenRequestRowSchema);

export const requestRowFrom: (row: ProjectedRow) => OpenRequestRow = Schema.decodeUnknownSync(OpenRequestRowSchema);

export function requestRowOf(row: ProjectedRow | undefined): OpenRequestRow | undefined {
  return row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
}

type Settling = Pick<OpenRequestRow, 'type' | 'answers' | 'standing'>;

export function isInteractionNotification({ type, answers }: Pick<OpenRequestRow, 'type' | 'answers'>): boolean {
  return type === interactionType && !answers;
}

export function settlementDueOf(row: Settling): 'settle_answered' | 'settle_delivered' | undefined {
  if (row.type === interactionType && row.standing === 'answered') {
    return 'settle_answered';
  }
  return isInteractionNotification(row) && row.standing === 'delivered' ? 'settle_delivered' : undefined;
}

export function endsUndelivered(row: Settling): boolean {
  return isInteractionNotification(row) && row.standing === 'undelivered';
}

export type UndueRequestRow = Omit<OpenRequestRow, 'attempt_due_at' | 'ending_due_at'>;

function settlesNow(row: UndueRequestRow): boolean {
  return settlementDueOf(row) !== undefined || endsUndelivered(row);
}

function awaitsThePlaybook(row: UndueRequestRow): boolean {
  return row.ended === null && row.standing !== 'cancelling';
}

export function attemptDueAtOf(row: UndueRequestRow): number | null {
  const awaitsAttempt = row.standing === 'to_deliver' || row.standing === 'retrying';
  return row.open && awaitsThePlaybook(row) && awaitsAttempt ? row.next_attempt_at : null;
}

export function endingDueAtOf(row: UndueRequestRow): number | null {
  if (!awaitsThePlaybook(row)) {
    return null;
  }
  if (settlesNow(row)) {
    return row.requested_at;
  }
  if (!row.open) {
    return null;
  }
  const lostAt = row.standing === 'delivering' ? row.next_attempt_at : null;
  return Math.min(row.expires_at, lostAt ?? Number.POSITIVE_INFINITY);
}

const DeliverySchema = Schema.Struct({ server: Schema.String, tool: Schema.String });

const readDelivery = Schema.decodeUnknownOption(DeliverySchema);

export function deliveryOf(deliver: Schema.JsonObject | undefined): string | null {
  return Option.match(readDelivery(deliver), {
    onNone: () => null,
    onSome: ({ server, tool }) => JSON.stringify({ server, tool }),
  });
}

const decodeDelivery = Schema.decodeUnknownSync(Schema.NullOr(Schema.fromJsonString(DeliverySchema)));

export function routeOfRow({ delivery }: Pick<OpenRequestRow, 'delivery'>): Route {
  return routeOf({ deliver: decodeDelivery(delivery) ?? undefined });
}
