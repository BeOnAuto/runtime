import { randomUUIDv7, type Unavailable } from '@on.auto/operations';
import { Effect, Function, Option } from 'effect';

import { caughtUp, executed, meterStateOf, meterUnavailable, nowIso } from '../admission/metering.ts';
import { standingAllocation } from '../allocations/allocation.ts';
import type { Allocation } from '../meter-stream/allocation-events.ts';
import type { License, MeterState } from '../meter-stream/meter-events.ts';
import { installationOfKey, keyDigestOf } from './license-key.ts';
import {
  isLiveAt,
  licenseInvalidated,
  licenseNotRenewed,
  nowMs,
  offlineCreditsStopped,
  type KeyInHand,
  type KeySource,
  type Licensing,
} from './licensing.ts';

export type LicenseState = 'unregistered' | 'licensed' | 'offline' | 'invalid';

export interface OfflineCredits {
  readonly credits: number;
  readonly spent: number;
  readonly usable_until: string;
}

export interface LicenseStatus {
  readonly state: LicenseState;
  readonly runtime_id: string;
  readonly free_runs: { readonly used: number; readonly of: number };
  readonly org: string | null;
  readonly plan: string | null;
  readonly expires_at: string | null;
  readonly renewed_at: string | null;
  readonly key_source: KeySource | null;
  readonly offline: OfflineCredits | null;
  readonly invalid_because: string | null;
}

type Standing = Pick<LicenseStatus, 'state' | 'offline' | 'invalid_because'>;

type LicenseFields = Pick<LicenseStatus, 'org' | 'plan' | 'expires_at' | 'renewed_at'>;

interface Reading {
  readonly licensing: Licensing;
  readonly state: MeterState;
  readonly inForce: KeyInHand | undefined;
  readonly actions: number;
  readonly now: number;
}

const notYetActivated =
  'This runtime holds a key it has not activated yet. It activates it with Auto as it starts its next run; check that it can reach billing.on.auto.';

const unregistered: Standing = { state: 'unregistered', offline: null, invalid_because: null };

const noLicense: LicenseFields = { org: null, plan: null, expires_at: null, renewed_at: null };

function invalidBecause(why: string, offline: OfflineCredits | null = null): Standing {
  return { state: 'invalid', offline, invalid_because: why };
}

function identified(licensing: Licensing, state: MeterState, inForce: KeyInHand | undefined) {
  return Effect.gen(function* () {
    const known = state.installation ?? (inForce === undefined ? undefined : installationOfKey(inForce.key));
    if (known !== undefined) return known;
    const fresh = randomUUIDv7();
    const after = yield* executed(licensing, { type: 'identify', installation: fresh, at: yield* nowIso }).pipe(
      Effect.mapError(() => meterUnavailable),
    );
    return Option.getOrElse(Option.fromNullishOr(after.installation), Function.constant(fresh));
  });
}

function projectedActions(licensing: Licensing, state: MeterState): Effect.Effect<number> {
  const kept = state.checkpoint?.actions ?? 0;
  return state.fault === undefined
    ? caughtUp(licensing, state).pipe(
        Effect.map(({ actions }) => actions),
        Effect.orElseSucceed(Function.constant(kept)),
      )
    : Effect.succeed(kept);
}

function licenseOf({ license }: MeterState, inForce: KeyInHand | undefined): License | undefined {
  return inForce !== undefined && license?.key_sha256 === keyDigestOf(inForce.key) ? license : undefined;
}

function fieldsOf(license: License | undefined): LicenseFields {
  if (license === undefined) return noLicense;
  const { org, plan, expires_at: expiresAt, issued_at: issuedAt } = license;
  return { org, plan, expires_at: expiresAt, renewed_at: issuedAt };
}

function offlineStanding({ licensing, actions, now }: Reading, allocation: Allocation): Standing {
  const { installation, credits, refresh_by: refreshBy } = allocation;
  const offline = { credits, spent: Math.max(0, actions - allocation.actions), usable_until: refreshBy };
  return isLiveAt(refreshBy, now)
    ? { state: 'offline', offline, invalid_because: null }
    : invalidBecause(offlineCreditsStopped(licensing.options, installation, refreshBy).detail, offline);
}

function keyedStanding({ licensing, now }: Reading, license: License | undefined): Standing {
  if (license === undefined) return invalidBecause(notYetActivated);
  const { options } = licensing;
  if (license.invalid !== undefined) {
    return invalidBecause(licenseInvalidated(options, license.installation, license.invalid).detail);
  }
  return isLiveAt(license.expires_at, now)
    ? { state: 'licensed', offline: null, invalid_because: null }
    : invalidBecause(licenseNotRenewed(options, license.installation, license.expires_at).detail);
}

function standingOf(reading: Reading, license: License | undefined): Standing {
  const allocation = standingAllocation(reading.state);
  if (allocation !== undefined) return offlineStanding(reading, allocation);
  return reading.inForce === undefined ? unregistered : keyedStanding(reading, license);
}

export function licenseStatusOf(licensing: Licensing): Effect.Effect<LicenseStatus, Unavailable> {
  return Effect.gen(function* () {
    const inForce = yield* licensing.keyInForce;
    const state = yield* meterStateOf(licensing);
    const runtimeId = yield* identified(licensing, state, inForce);
    const actions = yield* projectedActions(licensing, state);
    const reading = { licensing, state, inForce, actions, now: yield* nowMs };
    const license = licenseOf(state, inForce);
    const { allowance } = licensing.options;
    return {
      ...standingOf(reading, license),
      runtime_id: runtimeId,
      free_runs: { used: Math.min(actions, allowance), of: allowance },
      ...fieldsOf(license),
      key_source: inForce?.source ?? null,
    };
  }).pipe(Effect.catchDefect(() => Effect.fail(meterUnavailable)));
}
