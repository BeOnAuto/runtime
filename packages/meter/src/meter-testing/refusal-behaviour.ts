import { expect, it } from 'vitest';

import type { AccountFake, Revocation } from '../testing/account-fake.ts';
import type { Metered } from '../testing/metered.ts';
import type { Answer } from '../testing/runs.ts';
import { runOf } from '../testing/runs.ts';
import { admittedEach, licensedInstallation, licensedOn, opened, restartedOf, type LedgerOf } from './opened.ts';

const someWords: unknown = expect.any(String);

const installation = licensedInstallation;

const page = `https://studio.on.auto/licenses?installation=${installation}`;

const billing = 'https://studio.on.auto/?settings=billing&org=acme';

const liftsToday = '2026-10-28T00:00:00.000Z';

async function refusedAfterTheFreeRate(metered: Metered): Promise<Answer> {
  await admittedEach(metered, ['free-1', 'free-2']);
  return metered.admitted(runOf('free-3'));
}

function atTheFreeRate(account: AccountFake): void {
  account.policy({ per_day: 2, per_month: 4 });
}

function asLicenseInvalid(limitedBecause: string, liftsAt = liftsToday): Readonly<Record<string, unknown>> {
  return {
    kind: 'license_invalid',
    detail: someWords,
    because: 'free_daily_limit',
    resolve_at: page,
    runtime_id: installation,
    lifts_at: liftsAt,
    limited_because: limitedBecause,
  };
}

type KeyRefusal = readonly [string, (account: AccountFake, key: string) => void, string];

const keyRefusals: readonly KeyRefusal[] = [
  [
    'its key was rotated',
    (account, key) => {
      account.revoke(key, 'key_rotated');
    },
    'key_rotated',
  ],
  [
    'it was removed from its org',
    (account, key) => {
      account.revoke(key, 'installation_revoked');
    },
    'key_revoked',
  ],
  [
    'Auto no longer knows its key',
    (account, key) => {
      account.revoke(key);
    },
    'key_revoked',
  ],
  [
    'its org was deleted',
    (account) => {
      account.close({ detail: 'The org acme was deleted; Auto support can restore it', because: 'org_deleted' });
    },
    'org_closed',
  ],
  [
    'its org was deleted for good',
    (account) => {
      account.close({ detail: 'The org acme was deleted for good', because: 'org_purged' });
    },
    'org_closed',
  ],
];

function creditWordsBehaviour(ledgerOf: LedgerOf): void {
  it('refuses past the free rate of an org with no credits as credits_exhausted, saying where to add them', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      atTheFreeRate(account);
      account.fund('acme', { available: 0 });
    });

    expect(await refusedAfterTheFreeRate(metered)).toEqual({
      kind: 'credits_exhausted',
      detail: someWords,
      because: 'free_daily_limit',
      resolve_at: billing,
      runtime_id: installation,
      lifts_at: liftsToday,
      limited_because: 'credits',
    });
  });

  it('refuses past the free rate of an org at its overage cap as credits_exhausted, saying what credits repay', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      atTheFreeRate(account);
      account.fund('acme', { plan: 'team', available: 0, owed: 600, overage_cap: 600 });
    });

    expect(await refusedAfterTheFreeRate(metered)).toEqual({
      kind: 'credits_exhausted',
      detail: someWords,
      because: 'free_daily_limit',
      resolve_at: billing,
      runtime_id: installation,
      lifts_at: liftsToday,
      limited_because: 'cap',
    });
  });

  it('refuses past the free rate of a runtime out of touch since its limit as license_invalid, saying since when', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, atTheFreeRate);
    metered.account.goDown();
    metered.at('2026-11-24T12:00:00.000Z');

    expect(await refusedAfterTheFreeRate(metered)).toEqual(
      asLicenseInvalid('out_of_touch', '2026-11-25T00:00:00.000Z'),
    );
  });
}

function keyWordsBehaviour(ledgerOf: LedgerOf): void {
  it.each(keyRefusals)(
    'refuses past the free rate as license_invalid once a report says %s',
    async (_, refusing, limitedBecause) => {
      const { metered, key } = await licensedOn(ledgerOf, {}, atTheFreeRate);
      refusing(metered.account, key);
      await metered.reported();

      expect(await refusedAfterTheFreeRate(metered)).toEqual(asLicenseInvalid(limitedBecause));
    },
  );

  it('refuses past the free rate as license_invalid while it holds a key it has not activated', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, atTheFreeRate);
    const another = await restartedOf(metered, { key: metered.account.keyFor(installation) });
    const { metered: fresh } = await opened(ledgerOf, {
      allowance: 2,
      freeRate: { per_day: 2, per_month: 4 },
      key: metered.account.keyFor(installation),
    });
    await admittedEach(fresh, ['first-1', 'first-2']);

    expect(await refusedAfterTheFreeRate(another)).toEqual(asLicenseInvalid('not_activated'));
    expect(await refusedAfterTheFreeRate(fresh)).toEqual(asLicenseInvalid('not_activated'));
  });
}

export function fallbackWordsBehaviour(ledgerOf: LedgerOf): void {
  creditWordsBehaviour(ledgerOf);
  keyWordsBehaviour(ledgerOf);
}

const revocations: readonly (readonly [string, Revocation])[] = [
  ['its key was rotated', 'key_rotated'],
  ['it was removed from its org', 'installation_revoked'],
];

export const closedAccounts = [
  [
    'deleted, which can still be restored',
    {
      because: 'org_deleted',
      detail: 'The org acme was deleted; Auto support can restore it',
      resolve_at: 'https://studio.example.com/orgs/acme',
    },
  ],
  ['purged, which never runs again', { because: 'org_purged', detail: 'The org acme was deleted for good' }],
] as const;

export function closedAccountBehaviour(ledgerOf: LedgerOf): void {
  it.each(revocations)('refuses to activate a key as license_invalid when %s', async (_, because) => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    metered.account.revoke(key, because);

    expect(await metered.activated(key)).toEqual({
      kind: 'license_invalid',
      detail: someWords,
      because,
      resolve_at: page,
      runtime_id: installation,
    });
    expect((await metered.state()).refused).toMatchObject({ because });
  });

  it.each(closedAccounts)(
    'refuses to activate a key as account_closed when the org was %s, never as unavailable or as an invalid license',
    async (_, closed) => {
      const { metered } = await opened(ledgerOf);
      const key = metered.account.keyFor(installation);
      metered.account.close(closed);

      expect(await metered.activated(key)).toEqual({ kind: 'account_closed', ...closed });
    },
  );

  it('leaves out a reason for closing that is neither of the two, and a place to restore the org that is no URL', async () => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    metered.account.close({ detail: 'The org acme is closed', because: 'org_suspended', resolve_at: 'the org page' });

    expect(await metered.activated(key)).toEqual({ kind: 'account_closed', detail: 'The org acme is closed' });
    expect((await metered.state()).refused).toMatchObject({ because: 'org_deleted' });
  });
}

export function keptWordingBehaviour(ledgerOf: LedgerOf): void {
  it('refuses what is not a key of Studio, and a key Auto does not know, as license_invalid', async () => {
    const { metered } = await opened(ledgerOf);
    const notAKey = await metered.activated('alk_acme_secret');
    const unknown = await metered.activated(`alk.acme.${installation}.unknown`);

    expect(notAKey).toEqual({
      kind: 'license_invalid',
      detail: someWords,
      resolve_at: 'https://studio.on.auto/licenses',
    });
    expect(unknown).toEqual({
      kind: 'license_invalid',
      detail: someWords,
      resolve_at: page,
      runtime_id: installation,
    });
  });
}
