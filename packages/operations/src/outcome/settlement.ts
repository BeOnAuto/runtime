import { Schema } from 'effect';

import { CancelledKindSchema } from './cancelled-run.ts';
import { ConflictKindSchema } from './conflict.ts';
import { InvalidInputKindSchema } from './invalid-input.ts';
import { IssueSchema } from './issue.ts';
import { RejectionBecauseSchema } from './rejection-because.ts';
import { UnansweredKindSchema } from './unanswered-run.ts';
import { UnavailableKindSchema } from './unavailable.ts';

const settledBy = { by: Schema.optionalKey(Schema.NonEmptyString) };

const recorded = { record: Schema.optionalKey(Schema.JsonObject), ...settledBy };

const rejected = { status: Schema.Literal('rejected'), detail: Schema.String, ...recorded };

export const SettlementSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json, ...recorded }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('invalid_input'),
    kind: Schema.optionalKey(InvalidInputKindSchema),
    issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('unavailable'),
    kind: Schema.optionalKey(UnavailableKindSchema),
    because: Schema.optionalKey(RejectionBecauseSchema),
  }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('conflict'),
    kind: Schema.optionalKey(ConflictKindSchema),
    because: Schema.optionalKey(RejectionBecauseSchema),
  }),
  Schema.Struct({ ...rejected, reason: Schema.Literal('cancelled'), kind: CancelledKindSchema }),
  Schema.Struct({ ...rejected, reason: Schema.Literal('unanswered'), kind: UnansweredKindSchema }),
  Schema.Struct({ status: Schema.Literal('failed'), incident: Schema.optionalKey(Schema.String), ...settledBy }),
]);

export type Settlement = typeof SettlementSchema.Type;

export type SettledRejection = Extract<Settlement, { readonly status: 'rejected' }>;
