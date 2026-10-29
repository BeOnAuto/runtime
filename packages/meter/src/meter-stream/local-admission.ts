import type { Conflict } from '@on.auto/operations';
import { Result } from 'effect';

import type { Fallback } from '../licensing/signed-answers.ts';
import { freeRateInUse, freeRateLimitOf, type Basis } from './admission-events.ts';
import type { HeldLicense, KeyRefused } from './license-events.ts';
import type { LocalRule, OfflineRule } from './meter-commands.ts';
import type { MeterState } from './meter-events.ts';

export type LimitedBecause =
  | 'credits'
  | 'cap'
  | 'out_of_touch'
  | 'key_rotated'
  | 'key_revoked'
  | 'org_closed'
  | 'not_activated';

type RefusedBecause = Extract<LimitedBecause, 'key_rotated' | 'key_revoked' | 'org_closed'>;

export type Footing =
  | { readonly kind: 'keyless' }
  | { readonly kind: 'licensed'; readonly license: HeldLicense; readonly outOfTouch: boolean }
  | {
      readonly kind: 'limited';
      readonly because: Extract<LimitedBecause, 'credits' | 'cap' | 'out_of_touch'>;
      readonly license: HeldLicense;
    }
  | {
      readonly kind: 'limited';
      readonly because: RefusedBecause;
      readonly license: HeldLicense | undefined;
      readonly refused: KeyRefused;
    }
  | { readonly kind: 'limited'; readonly because: 'not_activated' };

function isPast(moment: string, at: string): boolean {
  return Date.parse(at) >= Date.parse(moment);
}

function refusedBecause({ because }: KeyRefused): RefusedBecause {
  if (because === 'key_rotated') return 'key_rotated';
  return because === 'org_deleted' || because === 'org_purged' ? 'org_closed' : 'key_revoked';
}

export function footingOf({ license, refused, admitted }: MeterState, sha256: string | undefined, at: string): Footing {
  if (sha256 === undefined) return { kind: 'keyless' };
  const ofTheKey = license?.key_sha256 === sha256 ? license : undefined;
  if (refused?.key_sha256 === sha256) {
    return { kind: 'limited', because: refusedBecause(refused), license: ofTheKey, refused };
  }
  if (ofTheKey === undefined) return { kind: 'limited', because: 'not_activated' };
  if (isPast(ofTheKey.limit_at, at)) return { kind: 'limited', because: 'out_of_touch', license: ofTheKey };
  if (admitted.licensed >= ofTheKey.admits_through) {
    return { kind: 'limited', because: ofTheKey.credits.overage_cap > 0 ? 'cap' : 'credits', license: ofTheKey };
  }
  return { kind: 'licensed', license: ofTheKey, outOfTouch: isPast(ofTheKey.warn_at, at) };
}

export function licenseOfFooting(footing: Footing): HeldLicense | undefined {
  return 'license' in footing ? footing.license : undefined;
}

export function freeRateOf({ license }: MeterState, builtIn: Fallback): Fallback {
  return license?.fallback ?? builtIn;
}

export function onFirstRuns({ license, admitted }: MeterState, allowance: number): boolean {
  return license === undefined && admitted.first_runs < allowance;
}

type Decision = Result.Result<Basis, Conflict>;

function localBasisOf(rule: LocalRule, state: MeterState, installation: string, at: string): Decision {
  const footing = footingOf(state, rule.key_sha256, at);
  if (footing.kind === 'licensed') return Result.succeed('licensed');
  if (onFirstRuns(state, rule.allowance)) return Result.succeed('first_runs');
  const rate = freeRateOf(state, rule.free_rate);
  const use = freeRateInUse(state.admitted, at);
  const limit = freeRateLimitOf(use, rate);
  if (limit === undefined) return Result.succeed('free_rate');
  const licensedEver = state.license !== undefined;
  return Result.fail(rule.refusal({ installation, footing, limit, rate, use, licensedEver, at }));
}

export function basisOf(rule: OfflineRule | LocalRule, state: MeterState, installation: string, at: string): Decision {
  if (rule.kind === 'local') return localBasisOf(rule, state, installation, at);
  return state.admitted.actions >= rule.through ? Result.fail(rule.refusal(installation)) : Result.succeed('offline');
}
