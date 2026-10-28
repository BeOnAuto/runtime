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
  'license_required',
  'license_invalid',
  'account_closed',
  'terms_required',
  'metering_fault',
]);

export type ConflictKind = typeof ConflictKindSchema.Type;

export interface Resolution {
  readonly resolve_at?: string;
  readonly runtime_id?: string;
}

export function resolutionOf({ resolve_at: resolveAt, runtime_id: runtimeId }: Resolution): Resolution {
  return {
    ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
    ...(runtimeId === undefined ? {} : { runtime_id: runtimeId }),
  };
}

interface Clash extends Resolution {
  readonly detail: string;
  readonly kind?: ConflictKind;
  readonly because?: RejectionBecause;
  readonly record?: Schema.JsonObject;
}

export class Conflict extends Data.TaggedError('conflict')<Clash> {}
