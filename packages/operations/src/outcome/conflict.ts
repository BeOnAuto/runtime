import { Data, Schema } from 'effect';

import type { RejectionBecause } from './rejection-because.ts';

export const ConflictKindSchema = Schema.Literals([
  'taken',
  'retired',
  'concurrent_change',
  'unworkable',
  'stalled',
  'tools_called',
  'effect_unknown',
  'oversized',
  'no_active_version',
  'data_changed',
  'build_in_flight',
  'dataset_too_large',
  'baseline_perfect',
  'unscorable',
  'not_a_build',
  'build_ended',
  'already_active',
  'connections_full',
  'credits_exhausted',
]);

export type ConflictKind = typeof ConflictKindSchema.Type;

export class Conflict extends Data.TaggedError('conflict')<{
  readonly detail: string;
  readonly kind?: ConflictKind;
  readonly because?: RejectionBecause;
  readonly record?: Schema.JsonObject;
}> {}
