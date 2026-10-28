import {
  AccountClosedBecauseSchema,
  Conflict,
  CreditsExhaustedBecauseSchema,
  Unavailable,
  type ConflictKind,
  type RejectionBecause,
} from '@on.auto/operations';
import { Clock, Effect, Schema } from 'effect';

import type { AccountRefusal } from '../accounts/account-failure.ts';
import type { AccountPorts, Usage } from '../accounts/account-service.ts';
import { executed, licensesPageOf, nowIso, type MeterOptions, type Metering } from '../admission/metering.ts';
import type { Counted } from '../counting/checkpoint-digest.ts';
import { isLicenseInvalidBecause, type Invalidity, type MeterState } from '../meter-stream/meter-events.ts';
import { keyDigestOf } from './license-key.ts';
import type { Signers } from './signed-answers.ts';

export type KeySource = 'environment' | 'configuration' | 'activated';

export interface KeyInHand {
  readonly key: string;
  readonly source: KeySource;
}

export interface Licensing extends Metering {
  readonly account: AccountPorts;
  readonly signers: Signers;
  readonly keyInForce: Effect.Effect<KeyInHand | undefined>;
  readonly keyInHand: Effect.Effect<string | undefined>;
  readonly keyHeld: (key: string) => Effect.Effect<void>;
}

export const accountUnavailable = new Unavailable({
  detail:
    'This runtime could not ask its account at Auto to admit the run, so the run was not started; ask again shortly',
  kind: 'meter_unavailable',
});

export const activationUnavailable = new Unavailable({
  detail: 'This runtime could not reach its account at Auto to activate its license; try again shortly',
  kind: 'meter_unavailable',
});

type RefusedAsAnswered = Extract<ConflictKind, 'credits_exhausted' | 'account_closed'>;

const becausesOf: Readonly<Record<RefusedAsAnswered, (because: unknown) => because is RejectionBecause>> = {
  credits_exhausted: Schema.is(CreditsExhaustedBecauseSchema),
  account_closed: Schema.is(AccountClosedBecauseSchema),
};

export function isRefusedAsAnswered(kind: string): kind is RefusedAsAnswered {
  return Object.hasOwn(becausesOf, kind);
}

export function refusedAsAnswered(
  kind: RefusedAsAnswered,
  { detail, because, resolve_at: resolveAt }: AccountRefusal,
): Conflict {
  return new Conflict({
    detail,
    kind,
    ...(becausesOf[kind](because) ? { because } : {}),
    ...(resolveAt !== undefined && URL.canParse(resolveAt) ? { resolve_at: resolveAt } : {}),
  });
}

function dayOf(moment: string): string {
  return moment.slice(0, 10);
}

function invalidDetailOf({ detail, because }: Invalidity, page: string): string {
  if (because === 'key_rotated') {
    return `This runtime's key was replaced. Activate the new key an owner was shown when they rotated it, then run this again. If the key is lost, an owner can rotate it again at ${page}.`;
  }
  if (because === 'installation_revoked') {
    return `This runtime was removed from its org. To use it again, an owner can register it again at ${page}, then activate the new key and run this again.`;
  }
  return `This runtime's license does not stand: ${detail}. Activate a key of this installation, which an owner of its org registers at ${page}`;
}

function refusedLicense(
  options: MeterOptions,
  installation: string | undefined,
  detailAt: (page: string) => string,
  because?: Invalidity['because'],
): Conflict {
  const page = licensesPageOf(options, installation);
  return new Conflict({
    detail: detailAt(page),
    kind: 'license_invalid',
    ...(because === undefined ? {} : { because }),
    resolve_at: page,
    ...(installation === undefined ? {} : { runtime_id: installation }),
  });
}

export function licenseInvalidated(
  options: MeterOptions,
  installation: string | undefined,
  invalidity: Invalidity,
): Conflict {
  return refusedLicense(options, installation, (page) => invalidDetailOf(invalidity, page), invalidity.because);
}

export function licenseInvalid(options: MeterOptions, installation: string | undefined, why: string): Conflict {
  return licenseInvalidated(options, installation, { detail: why });
}

export function licenseNotRenewed(options: MeterOptions, installation: string, expiresAt: string): Conflict {
  return refusedLicense(
    options,
    installation,
    () =>
      `This runtime's license wasn't renewed by ${dayOf(expiresAt)}. Check that it can reach billing.on.auto (it renews every day), then run this again.`,
  );
}

export function offlineCreditsStopped(options: MeterOptions, installation: string, refreshBy: string): Conflict {
  return refusedLicense(
    options,
    installation,
    (page) => `These offline credits stopped on ${dayOf(refreshBy)}. An owner can request new ones at ${page}.`,
  );
}

export function invalidityOf({ detail, because }: AccountRefusal): Invalidity {
  return isLicenseInvalidBecause(because) ? { detail, because } : { detail };
}

export function usageFrom(counted: Partial<Counted> | undefined): Usage {
  return { actions: counted?.actions ?? 0, through: counted?.through ?? null, last: counted?.last ?? null };
}

export function standsFor({ license }: MeterState, key: string): boolean {
  return license?.key_sha256 === keyDigestOf(key) && license.invalid === undefined;
}

export const nowMs = Clock.currentTimeMillis;

export function isLiveAt(expiresAt: string, now: number): boolean {
  return Date.parse(expiresAt) > now;
}

export function invalidated(licensing: Licensing, key: string, invalidity: Invalidity): Effect.Effect<void> {
  return Effect.ignore(
    Effect.flatMap(nowIso, (at) =>
      executed(licensing, { type: 'invalidate', key_sha256: keyDigestOf(key), invalidity, at }),
    ),
  );
}
