import { Data, Schema } from 'effect';

import type { LimitedBecause, RejectionBecause } from './rejection-because.ts';
import { Unavailable } from './unavailable.ts';

export const ConflictKindSchema = Schema.Literals([
  'taken',
  'retired',
  'paused',
  'concurrent_change',
  'unworkable',
  'stalled',
  'tools_called',
  'effect_unknown',
  'oversized',
  'history_too_short',
  'feature_unlicensed',
  'connections_full',
  'credits_exhausted',
  'license_required',
  'license_invalid',
  'account_closed',
  'blocked_by_moderation',
  'incomplete',
  'in_use',
  'runs_in_progress',
  'connection_not_accessible',
]);

export type ConflictKind = typeof ConflictKindSchema.Type;

export interface Resolution {
  readonly resolve_at?: string;
  readonly runtime_id?: string;
  readonly lifts_at?: string;
  readonly limited_because?: LimitedBecause;
  readonly retry_after?: number;
}

export function resolutionOf({
  resolve_at: resolveAt,
  runtime_id: runtimeId,
  lifts_at: liftsAt,
  limited_because: limitedBecause,
  retry_after: retryAfter,
}: Resolution): Resolution {
  return {
    ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
    ...(runtimeId === undefined ? {} : { runtime_id: runtimeId }),
    ...(liftsAt === undefined ? {} : { lifts_at: liftsAt }),
    ...(limitedBecause === undefined ? {} : { limited_because: limitedBecause }),
    ...(retryAfter === undefined ? {} : { retry_after: retryAfter }),
  };
}

interface Clash extends Resolution {
  readonly detail: string;
  readonly kind?: ConflictKind;
  readonly because?: RejectionBecause;
  readonly record?: Schema.JsonObject;
}

export class Conflict extends Data.TaggedError('conflict')<Clash> {}

export function resolutionIn(rejection: unknown): Resolution {
  return rejection instanceof Conflict || rejection instanceof Unavailable ? resolutionOf(rejection) : {};
}
