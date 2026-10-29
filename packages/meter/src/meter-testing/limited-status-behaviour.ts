import { expect, it } from 'vitest';

import { runOf } from '../testing/runs.ts';
import {
  admittedEach,
  allocatedOn,
  licensedInstallation,
  licensedOn,
  opened,
  restartedOf,
  type LedgerOf,
} from './opened.ts';

const installation = licensedInstallation;

const billing = 'https://studio.on.auto/?settings=billing&org=acme';

const noLicense = {
  org: null,
  org_name: null,
  plan: null,
  standing: null,
  credits: null,
  issued_at: null,
  warn_at: null,
  limit_at: null,
  last_report_at: null,
};

function limitedByCreditsBehaviour(ledgerOf: LedgerOf): void {
  it('reads limited by its credits, with no runs left on its license, the free rate it runs at, and how to fix it', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      account.fund('acme', { available: 0 });
    });
    await admittedEach(metered, ['run-1']);

    expect(await metered.status()).toMatchObject({
      state: 'limited',
      limited_because: 'credits',
      standing: 'capped',
      licensed: 0,
      runs_left: 0,
      fallback: { per_day: 15, per_month: 75, used_today: 1, used_this_month: 1, lifts_at: null },
      summary: `This runtime's org has no credits left, so it runs at the free rate of 15 runs a UTC day and 75 a UTC month. It has used 1 of today's 15 and 1 of this month's 75. An owner can add credits at ${billing}; the runtime takes them at its next report, within the hour.`,
    });
  });

  it.each([
    ['cap', { plan: 'team', available: 0, owed: 600, overage_cap: 600 }],
    ['credits', { available: 0 }],
  ] as const)('reads limited by %s once its license admits no more', async (because, books) => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      account.fund('acme', books);
    });

    expect((await metered.status()).limited_because).toBe(because);
  });

  it('reads limited out of touch from the day Auto limits from', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.at('2026-11-24T12:00:00.000Z');

    expect(await metered.status()).toMatchObject({ state: 'limited', limited_because: 'out_of_touch', runs_left: 0 });
  });
}

function keyLimitedStatusBehaviour(ledgerOf: LedgerOf): void {
  it.each([
    ['key_rotated', 'key_rotated'],
    ['key_revoked', 'installation_revoked'],
  ] as const)('reads limited as %s once a report says so', async (because, revocation) => {
    const { metered, key } = await licensedOn(ledgerOf);
    metered.account.revoke(key, revocation);
    await metered.reported();

    expect(await metered.status()).toMatchObject({ state: 'limited', limited_because: because, org: 'acme' });
  });

  it('reads limited as org_closed once a report says its org was closed', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.close({ detail: 'The org acme was deleted; an owner can restore it', because: 'org_deleted' });
    await metered.reported();

    expect((await metered.status()).limited_because).toBe('org_closed');
  });

  it('reads limited as not activated while it holds a key Auto has not answered for yet, still on its first runs', async () => {
    const { metered } = await opened(ledgerOf);
    const keyed = await restartedOf(metered, { key: metered.account.keyFor(installation) });
    await keyed.admitted(runOf('run-1'));

    expect(await keyed.status()).toMatchObject({
      state: 'limited',
      limited_because: 'not_activated',
      runtime_id: installation,
      free_runs: { used: 1, of: 100 },
      ...noLicense,
      runs_left: null,
      fallback: null,
      key_source: 'environment',
      summary:
        "This runtime holds a key it hasn't activated with Auto yet; until it does, it runs its free runs, 1 of 100 used, then the free rate of 15 runs a UTC day and 75 a UTC month. Check that it can reach billing.on.auto; it activates the key at its next report, within the hour.",
    });
  });
}

function offlineStatusBehaviour(ledgerOf: LedgerOf): void {
  it('reads offline with the credits it holds, what it spent of them and until when, 30 days unless signed for 90', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5, false);
    await admittedEach(metered, ['run-1', 'run-2']);
    const { metered: longer } = await allocatedOn(ledgerOf, 5, false, 90);

    expect(await metered.status()).toMatchObject({
      state: 'offline',
      runtime_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f',
      limited_because: null,
      fallback: null,
      key_source: null,
      offline: { credits: 5, spent: 2, usable_until: '2026-11-26T12:00:00.000Z' },
      invalid_because: null,
      summary: 'Offline credits: 2 of 5 used, usable until 2026-11-26',
    });
    expect((await longer.status()).offline?.usable_until).toBe('2027-01-25T12:00:00.000Z');
  });

  it('reads invalid once its offline credits stopped, still giving them', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5);
    metered.at('2026-11-27T12:00:00.000Z');
    const stopped =
      'These offline credits stopped on 2026-11-26. An owner can request new ones at https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f.';

    expect(await metered.status()).toMatchObject({
      state: 'invalid',
      key_source: 'environment',
      offline: { credits: 5, spent: 0, usable_until: '2026-11-26T12:00:00.000Z' },
      invalid_because: stopped,
      summary: stopped,
    });
  });
}

export function limitedStatusBehaviour(ledgerOf: LedgerOf): void {
  limitedByCreditsBehaviour(ledgerOf);
  keyLimitedStatusBehaviour(ledgerOf);
  offlineStatusBehaviour(ledgerOf);
}
