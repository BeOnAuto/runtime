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
      summary: `2 of 100 free runs used, then the free rate of 15 runs a UTC day and 75 a UTC month without a key. Get a free key at ${free}.`,
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
      summary: `This runtime has used its 2 free runs, and without a key it runs at the free rate of 2 runs a UTC day and 4 a UTC month. It has used 2 of today's 2 and 2 of this month's 4. It can run again from 2026-10-28 00:00 UTC. To run more, get a free key at ${free}, then activate it on the runtime.`,
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
      summary: 'Licensed to acme (free plan): 999 runs left.',
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
        "Licensed to Acme Corporation (free plan): 1000 runs left. It hasn't reached Auto since 2026-10-27; unless it reaches billing.on.auto, it runs at the free rate from 2026-11-24.",
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
    `Licensed to acme (free plan): 100 runs left. Its org's credits are low; an owner can add credits at ${billing}.`,
  ],
  [
    'empty',
    { plan: 'team', available: 0, overage_cap: 600 },
    `Licensed to acme (team plan): 600 runs left. Its org has no credits left, so its runs go into overage, which its next credits repay; an owner can add credits at ${billing}.`,
  ],
  [
    'overage',
    { plan: 'team', available: 0, owed: 30, overage_cap: 600 },
    'Licensed to acme (team plan): 570 runs left. It is in overage: the org owes 30 of at most 600 credits, which its next credits repay.',
  ],
  [
    'near_cap',
    { plan: 'team', available: 0, owed: 500, overage_cap: 600 },
    `Licensed to acme (team plan): 100 runs left. It is near its overage cap: the org owes 500 of at most 600 credits, which its next credits repay; an owner can add credits at ${billing}.`,
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
