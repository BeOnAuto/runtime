import { expect, it } from 'vitest';

import type { Revocation } from '../testing/account-fake.ts';
import { runOf } from '../testing/runs.ts';
import { licensedInstallation, licensedOn, opened, restartedOf, type LedgerOf } from './opened.ts';

const installation = licensedInstallation;

const page = `https://studio.on.auto/licenses?installation=${installation}`;

const rotatedWords = `This runtime's key was replaced. Activate the new key an owner was shown when they rotated it, then run this again. If the key is lost, an owner can rotate it again at ${page}.`;

const removedWords = `This runtime was removed from its org. To use it again, an owner can register it again at ${page}, then activate the new key and run this again.`;

const revocations: readonly (readonly [string, Revocation, string])[] = [
  ['its key was rotated', 'key_rotated', rotatedWords],
  ['its installation was removed from its org', 'installation_revoked', removedWords],
];

export function revocationCaseBehaviour(ledgerOf: LedgerOf): void {
  it.each(revocations)(
    'refuses a run in the words of the case when the account says %s, and every run after it',
    async (_, because, detail) => {
      const { metered, key } = await licensedOn(ledgerOf);
      await metered.admitted(runOf('run-1'));
      metered.account.revoke(key, because);
      const refused = await metered.admitted(runOf('run-2'));
      const restarted = await restartedOf(metered);

      expect(refused).toEqual({ kind: 'license_invalid', detail, because, resolve_at: page, runtime_id: installation });
      expect(await restarted.admitted(runOf('run-3'))).toEqual(refused);
      expect((await restarted.state()).license?.invalid).toMatchObject({ because });
    },
  );

  it.each(revocations)('refuses to activate a key in the words of the case when %s', async (_, because, detail) => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    metered.account.revoke(key, because);

    expect(await metered.activated(key)).toEqual({
      kind: 'license_invalid',
      detail,
      because,
      resolve_at: page,
      runtime_id: installation,
    });
  });
}

export function creditCaseBehaviour(ledgerOf: LedgerOf): void {
  it.each(['none_left', 'free_daily_limit', 'free_month_used'])(
    'refuses as credits_exhausted with the case %s the account names, and where it says the org gets more',
    async (because) => {
      const { metered } = await licensedOn(ledgerOf);
      metered.account.exhaust({ because, resolve_at: 'https://studio.on.auto/billing?org=acme' });

      expect(await metered.admitted(runOf('run-1'))).toEqual({
        kind: 'credits_exhausted',
        detail: 'The org acme has no credits left',
        because,
        resolve_at: 'https://studio.on.auto/billing?org=acme',
      });
    },
  );

  it('leaves out a case of credits it does not know, and a place to resolve them that is no URL', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.exhaust({ because: 'over_the_moon', resolve_at: 'the billing page' });

    expect(await metered.admitted(runOf('run-1'))).toEqual({
      kind: 'credits_exhausted',
      detail: 'The org acme has no credits left',
    });
  });
}

export function keptWordingBehaviour(ledgerOf: LedgerOf): void {
  it('refuses what is not a key of Studio, and a key Auto does not know, as license_invalid', async () => {
    const { metered } = await opened(ledgerOf);
    const notAKey = await metered.activated('alk_acme_secret');
    const unknown = await metered.activated(`alk.acme.${installation}.unknown`);

    expect(notAKey).toEqual({
      kind: 'license_invalid',
      detail:
        "This runtime's license does not stand: its key is not a license key of Studio, which reads alk.<org>.<installation>.<secret>. Activate a key of this installation, which an owner of its org registers at https://studio.on.auto/licenses",
      resolve_at: 'https://studio.on.auto/licenses',
    });
    expect(unknown).toEqual({
      kind: 'license_invalid',
      detail: `This runtime's license does not stand: The key is unknown, was rotated away or its installation was revoked. Activate a key of this installation, which an owner of its org registers at ${page}`,
      resolve_at: page,
      runtime_id: installation,
    });
  });
}
