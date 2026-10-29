import { expect, it } from 'vitest';

import type { AccountFake, Revocation } from '../testing/account-fake.ts';
import type { Metered } from '../testing/metered.ts';
import type { Answer } from '../testing/runs.ts';
import { runOf } from '../testing/runs.ts';
import { admittedEach, licensedInstallation, licensedOn, opened, restartedOf, type LedgerOf } from './opened.ts';

const installation = licensedInstallation;

const page = `https://studio.on.auto/licenses?installation=${installation}`;

const billing = 'https://studio.on.auto/?settings=billing&org=acme';

const freeRate = 'the free rate of 2 runs a UTC day and 4 a UTC month';

const usedToday = "It has used today's 2, so it can run again from 2026-10-28 00:00 UTC.";

async function refusedAfterTheFreeRate(metered: Metered): Promise<Answer> {
  await admittedEach(metered, ['free-1', 'free-2']);
  return metered.admitted(runOf('free-3'));
}

function atTheFreeRate(account: AccountFake): void {
  account.policy({ per_day: 2, per_month: 4 });
}

function asLicenseInvalid(detail: string): Answer {
  return { kind: 'license_invalid', detail, because: 'free_daily_limit', resolve_at: page, runtime_id: installation };
}

const keyRefusals: readonly (readonly [string, (account: AccountFake, key: string) => void, string])[] = [
  [
    'its key was rotated',
    (account, key) => {
      account.revoke(key, 'key_rotated');
    },
    `This runtime's key was replaced, so it runs at ${freeRate}. ${usedToday} Activate the new key an owner was shown when they rotated it; if the key is lost, an owner can rotate it again at ${page}.`,
  ],
  [
    'it was removed from its org',
    (account, key) => {
      account.revoke(key, 'installation_revoked');
    },
    `This runtime was removed from its org, so it runs at ${freeRate}. ${usedToday} To run on its org's credits again, an owner can register it again at ${page}, then activate the new key.`,
  ],
  [
    'Auto no longer knows its key',
    (account, key) => {
      account.revoke(key);
    },
    `Auto no longer accepts this runtime's key, so it runs at ${freeRate}. ${usedToday} Activate a key of this runtime, which an owner registers at ${page}.`,
  ],
  [
    'its org was deleted',
    (account) => {
      account.close({ detail: 'The org acme was deleted; an owner can restore it', because: 'org_deleted' });
    },
    `This runtime's org at Auto is closed, so it runs at ${freeRate}. ${usedToday} If an owner restores the org, the runtime goes back to its credits at its next report; or activate a key of another org, which an owner registers at ${page}.`,
  ],
  [
    'its org was deleted for good',
    (account) => {
      account.close({ detail: 'The org acme was deleted for good', because: 'org_purged' });
    },
    `This runtime's org at Auto is closed, so it runs at ${freeRate}. ${usedToday} The org can't be restored; activate a key of another org, which an owner registers at ${page}.`,
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
      detail: `This runtime's org has no credits left, so it runs at ${freeRate}. ${usedToday} An owner can add credits at ${billing}; the runtime takes them at its next report, within the hour.`,
      because: 'free_daily_limit',
      resolve_at: billing,
      runtime_id: installation,
    });
  });

  it('refuses past the free rate of an org at its overage cap as credits_exhausted, saying what credits repay', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      atTheFreeRate(account);
      account.fund('acme', { plan: 'team', available: 0, owed: 600, overage_cap: 600 });
    });

    expect(await refusedAfterTheFreeRate(metered)).toEqual({
      kind: 'credits_exhausted',
      detail: `This runtime's org has reached its overage cap of 600 credits, so it runs at ${freeRate}. ${usedToday} An owner can add credits at ${billing}, which repay what is owed first; the runtime takes them at its next report, within the hour.`,
      because: 'free_daily_limit',
      resolve_at: billing,
      runtime_id: installation,
    });
  });

  it('refuses past the free rate of a runtime out of touch since its limit as license_invalid, saying since when', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, atTheFreeRate);
    metered.account.goDown();
    metered.at('2026-11-24T12:00:00.000Z');

    expect(await refusedAfterTheFreeRate(metered)).toEqual({
      ...asLicenseInvalid(
        `This runtime hasn't reached Auto since 2026-10-27, so since 2026-11-24 it runs at ${freeRate}. It has used today's 2, so it can run again from 2026-11-25 00:00 UTC. Check that it can reach billing.on.auto; it goes back to its org's credits at its next report.`,
      ),
    });
  });
}

function keyWordsBehaviour(ledgerOf: LedgerOf): void {
  it.each(keyRefusals)(
    'refuses past the free rate as license_invalid once a report says %s, in the words of the case',
    async (_, refusing, detail) => {
      const { metered, key } = await licensedOn(ledgerOf, {}, atTheFreeRate);
      refusing(metered.account, key);
      await metered.reported();

      expect(await refusedAfterTheFreeRate(metered)).toEqual(asLicenseInvalid(detail));
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

    expect(await refusedAfterTheFreeRate(another)).toEqual(
      asLicenseInvalid(
        `This runtime holds a key it hasn't activated with Auto yet, so it runs at ${freeRate}. ${usedToday} Check that it can reach billing.on.auto; it activates the key at its next report, within the hour.`,
      ),
    );
    expect(await refusedAfterTheFreeRate(fresh)).toEqual(
      asLicenseInvalid(
        `This runtime has used its 2 free runs and holds a key it hasn't activated with Auto yet, so it runs at ${freeRate}. ${usedToday} Check that it can reach billing.on.auto; it activates the key at its next report, within the hour.`,
      ),
    );
  });
}

export function fallbackWordsBehaviour(ledgerOf: LedgerOf): void {
  creditWordsBehaviour(ledgerOf);
  keyWordsBehaviour(ledgerOf);
}

const rotatedWords = `This runtime's key was replaced. Activate the new key an owner was shown when they rotated it, then run this again. If the key is lost, an owner can rotate it again at ${page}.`;

const removedWords = `This runtime was removed from its org. To use it again, an owner can register it again at ${page}, then activate the new key and run this again.`;

const revocations: readonly (readonly [string, Revocation, string])[] = [
  ['its key was rotated', 'key_rotated', rotatedWords],
  ['it was removed from its org', 'installation_revoked', removedWords],
];

export const closedAccounts = [
  [
    'deleted, which can still be restored',
    {
      because: 'org_deleted',
      detail: 'The org acme was deleted; an owner can restore it',
      resolve_at: 'https://studio.example.com/orgs/acme',
    },
  ],
  ['purged, which never runs again', { because: 'org_purged', detail: 'The org acme was deleted for good' }],
] as const;

export function closedAccountBehaviour(ledgerOf: LedgerOf): void {
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
      detail:
        "This runtime's license does not stand: its key is not a license key of Studio, which reads alk.<org>.<runtime id>.<secret>. Activate a key of this runtime, which an owner of its org registers at https://studio.on.auto/licenses",
      resolve_at: 'https://studio.on.auto/licenses',
    });
    expect(unknown).toEqual({
      kind: 'license_invalid',
      detail: `This runtime's license does not stand: The key is unknown, was rotated away or its runtime was removed. Activate a key of this runtime, which an owner of its org registers at ${page}`,
      resolve_at: page,
      runtime_id: installation,
    });
  });
}
