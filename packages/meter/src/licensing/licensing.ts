import { Conflict, Unavailable } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import type { AccountPorts, Usage } from '../accounts/account-service.ts';
import { executed, nowIso, type MeterOptions, type Metering } from '../admission/metering.ts';
import type { Counted } from '../counting/checkpoint-digest.ts';
import type { MeterState } from '../meter-stream/meter-events.ts';
import { keyDigestOf } from './license-key.ts';
import type { Signers } from './signed-answers.ts';

export interface Licensing extends Metering {
  readonly account: AccountPorts;
  readonly signers: Signers;
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

export function licenseInvalid({ studio }: MeterOptions, installation: string | undefined, why: string): Conflict {
  const page = installation === undefined ? `${studio}/licenses` : `${studio}/licenses?installation=${installation}`;
  return new Conflict({
    detail: `This runtime's license does not stand: ${why}. Activate a key of this installation, which an owner of its org registers at ${page}`,
    kind: 'license_invalid',
  });
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

export function invalidated(licensing: Licensing, key: string, detail: string): Effect.Effect<void> {
  return Effect.ignore(
    Effect.flatMap(nowIso, (at) =>
      executed(licensing, { type: 'invalidate', key_sha256: keyDigestOf(key), detail, at }),
    ),
  );
}
