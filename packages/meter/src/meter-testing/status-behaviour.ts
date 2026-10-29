import { expect, it } from 'vitest';

import { limitedStatusBehaviour } from './limited-status-behaviour.ts';
import { admittedEach, licensedInstallation, licensedOn, opened, type LedgerOf } from './opened.ts';

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

const firstLicense = {
  org: 'acme',
  org_name: null,
  plan: 'free',
  standing: 'ok',
  credits: { available: 1000, owed: 0, overage_cap: 0 },
  issued_at: '2026-10-27T12:00:00.000Z',
  warn_at: '2026-11-10T12:00:00.000Z',
  limit_at: '2026-11-24T12:00:00.000Z',
  last_report_at: '2026-10-27T12:00:00.000Z',
};

function keylessStatusBehaviour(ledgerOf: LedgerOf): void {
  it('reads unregistered with its free runs, identifying its runtime once, which its first admission keeps', async () => {
    const { metered } = await opened(ledgerOf);
    const first = await metered.status();
    await admittedEach(metered, ['run-1', 'run-2']);
    const runtime = first.runtime_id;
    const free = `https://studio.on.auto/licenses?installation=${runtime}`;

    expect(await metered.status()).toEqual({
      state: 'unregistered',
      limited_because: null,
      runtime_id: runtime,
      free_runs: { used: 2, of: 100 },
      ...noLicense,
      licensed: 0,
      runs_left: null,
      fallback: null,
      key_source: null,
      offline: null,
      invalid_because: null,
      summary: `This runtime has used 2 of its 100 free runs. After that, without a license key, it's limited to the free rate of 15 runs a UTC day and 75 a UTC month. Get a free license key at ${free}.`,
    });
    expect((await metered.state()).installation).toBe(runtime);
  });

  it('reads the free rate it runs at once its first runs are used, and when it lifts once reached', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 2, freeRate: { per_day: 2, per_month: 4 } });
    await admittedEach(metered, ['run-1', 'run-2', 'run-3']);
    const running = await metered.status();
    await admittedEach(metered, ['run-4']);
    const reached = await metered.status();
    const free = `https://studio.on.auto/licenses?installation=${reached.runtime_id}`;

    expect(running).toMatchObject({
      state: 'unregistered',
      free_runs: { used: 2, of: 2 },
      fallback: { per_day: 2, per_month: 4, used_today: 1, used_this_month: 1, lifts_at: null },
    });
    expect(reached).toMatchObject({
      fallback: { used_today: 2, used_this_month: 2, lifts_at: '2026-10-28T00:00:00.000Z' },
      summary: `This runtime has used its 2 free runs. Without a license key, it's limited to the free rate of 2 runs a UTC day and 4 a UTC month. It has used 2 of today's 2 runs and 2 of this month's 4. It can start runs again at 00:00 UTC on 2026-10-28. To run more, get a free license key at ${free} and activate it on this runtime.`,
    });
  });
}

function unreadStatusBehaviour(ledgerOf: LedgerOf): void {
  it('refuses as meter_unavailable when it cannot record the runtime it identifies', async () => {
    const { metered } = await opened(ledgerOf);
    metered.executesFail('conflict');
    const lost = await metered.refusedStatus();
    metered.executesFail('defect');

    expect([lost.kind, (await metered.refusedStatus()).kind]).toEqual(['meter_unavailable', 'meter_unavailable']);
  });
}

function licensedStatusBehaviour(ledgerOf: LedgerOf): void {
  it('reads licensed with the runs it has left, its license and where its key came from', async () => {
    const { metered } = await licensedOn(ledgerOf, { keySource: 'configuration' });
    await admittedEach(metered, ['run-1']);

    expect(await metered.status()).toEqual({
      state: 'licensed',
      limited_because: null,
      runtime_id: installation,
      free_runs: null,
      ...firstLicense,
      licensed: 1,
      runs_left: 999,
      fallback: null,
      key_source: 'configuration',
      offline: null,
      invalid_because: null,
      summary: 'Licensed to acme on the free plan, with 999 runs left.',
    });
  });

  it('reads out of touch from the day Auto warns from, saying until when it runs on its license', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.orgNamed('acme', 'Acme Corporation');
    await metered.reported();
    metered.at('2026-11-10T12:00:00.000Z');

    expect(await metered.status()).toMatchObject({
      state: 'out_of_touch',
      org_name: 'Acme Corporation',
      summary:
        "Licensed to Acme Corporation on the free plan, with 1000 runs left. It hasn't reached Auto since 2026-10-27. It will be limited to the free rate from 2026-11-24 unless it reaches billing.on.auto first.",
    });
  });

  it('reads a key activated through it as activated', async () => {
    const { metered } = await opened(ledgerOf);
    await metered.activated(metered.account.keyFor(installation));

    expect(await metered.status()).toMatchObject({ state: 'licensed', key_source: 'activated' });
  });
}

const standings = [
  [
    'low',
    { available: 100 },
    `Licensed to acme on the free plan, with 100 runs left. The organization's credits are running low. The account holder or an organization admin can add credits at ${billing}.`,
  ],
  [
    'empty',
    { plan: 'team', available: 0, overage_cap: 600 },
    `Licensed to acme on the team plan, with 600 runs left. The organization is out of credits, so new runs go into overage, up to its cap of 600 credits. The account holder or an organization admin can add credits at ${billing}; new credits repay the overage first.`,
  ],
  [
    'overage',
    { plan: 'team', available: 0, owed: 30, overage_cap: 600 },
    'Licensed to acme on the team plan, with 570 runs left. The organization owes 30 credits of overage, and its cap is 600. Its next credits repay the overage first.',
  ],
  [
    'overage',
    { plan: 'team', available: 0, owed: 1, overage_cap: 600 },
    'Licensed to acme on the team plan, with 599 runs left. The organization owes 1 credit of overage, and its cap is 600. Its next credits repay the overage first.',
  ],
  [
    'near_cap',
    { plan: 'team', available: 0, owed: 500, overage_cap: 600 },
    `Licensed to acme on the team plan, with 100 runs left. The organization owes 500 credits of overage, close to its cap of 600. At the cap, this runtime is limited to the free rate. The account holder or an organization admin can add credits at ${billing}; new credits repay the overage first.`,
  ],
  [
    'near_cap',
    { plan: 'team', available: 0, owed: 599, overage_cap: 600 },
    `Licensed to acme on the team plan, with 1 run left. The organization owes 599 credits of overage, close to its cap of 600. At the cap, this runtime is limited to the free rate. The account holder or an organization admin can add credits at ${billing}; new credits repay the overage first.`,
  ],
] as const;

function standingStatusBehaviour(ledgerOf: LedgerOf): void {
  it.each(standings)('says so in its words while its org is %s', async (standing, books, summary) => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      account.fund('acme', books);
    });

    expect(await metered.status()).toMatchObject({ standing, summary });
  });
}

export function statusBehaviour(ledgerOf: LedgerOf): void {
  keylessStatusBehaviour(ledgerOf);
  unreadStatusBehaviour(ledgerOf);
  licensedStatusBehaviour(ledgerOf);
  standingStatusBehaviour(ledgerOf);
  limitedStatusBehaviour(ledgerOf);
}
