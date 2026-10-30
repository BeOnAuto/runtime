import type { ProjectedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

export const predictionBuildsName = 'prediction_builds';

const StandingSchema = Schema.Literals([
  'starting_request',
  'waiting_for_trainer',
  'scoring',
  'in_shadow',
  'awaiting_approval',
  'ended',
]);

const BuildRowSchema = Schema.Struct({
  function: Schema.String,
  definition_version: Schema.Int,
  standing: StandingSchema,
  through: Schema.NullOr(Schema.String),
  requested_at: Schema.Int,
  expires_at: Schema.NullOr(Schema.Int),
  uploaded: Schema.Int,
  scored: Schema.Int,
  winner: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.Int),
  rule: Schema.NullOr(Schema.Literals(['automatic', 'approved'])),
  shadow_origins: Schema.Int,
  next_due_at: Schema.NullOr(Schema.Int),
  open: Schema.Boolean,
  scoring_since: Schema.NullOr(Schema.Int),
  ended: Schema.NullOr(Schema.String),
  staged: Schema.Boolean,
  cause: Schema.String,
});

export type BuildRow = typeof BuildRowSchema.Type;

const decodeRow = Schema.decodeUnknownOption(BuildRowSchema);

export const buildRowFrom: (row: ProjectedRow) => BuildRow = Schema.decodeUnknownSync(BuildRowSchema);

export function buildRowOf(row: ProjectedRow | undefined): BuildRow | undefined {
  return row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
}
