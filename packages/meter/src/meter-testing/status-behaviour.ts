import { expect, it } from 'vitest';

import { limitedStatusBehaviour } from './limited-status-behaviour.ts';
import { admittedEach, licensedInstallation, licensedOn, opened, type LedgerOf } from './opened.ts';

const someWords: unknown = expect.any(String);

const installation = licensedInstallation;

const noLicense = {
  org: null,
  org_name: null,
  plan: null,
  features: [],
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
  features: [],
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
      summary: someWords,
    });
    expect((await metered.state()).installation).toBe(runtime);
  });

  it('reads the free rate it runs at once its first runs are used, and when it lifts once reached', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 2, freeRate: { per_day: 2, per_month: 4 } });
    await admittedEach(metered, ['run-1', 'run-2', 'run-3']);
    const running = await metered.status();
    await admittedEach(metered, ['run-4']);
    const reached = await metered.status();

    expect(running).toMatchObject({
      state: 'unregistered',
      free_runs: { used: 2, of: 2 },
      fallback: { per_day: 2, per_month: 4, used_today: 1, used_this_month: 1, lifts_at: null },
    });
    expect(reached).toMatchObject({
      fallback: { used_today: 2, used_this_month: 2, lifts_at: '2026-10-28T00:00:00.000Z' },
      summary: someWords,
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
      summary: someWords,
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
      summary: someWords,
    });
  });

  it('reads a key activated through it as activated', async () => {
    const { metered } = await opened(ledgerOf);
    await metered.activated(metered.account.keyFor(installation));

    expect(await metered.status()).toMatchObject({ state: 'licensed', key_source: 'activated' });
  });
}

const standings = [
  ['low', { available: 100 }],
  ['empty', { plan: 'team', available: 0, overage_cap: 600 }],
  ['overage', { plan: 'team', available: 0, owed: 30, overage_cap: 600 }],
  ['overage', { plan: 'team', available: 0, owed: 1, overage_cap: 600 }],
  ['near_cap', { plan: 'team', available: 0, owed: 500, overage_cap: 600 }],
  ['near_cap', { plan: 'team', available: 0, owed: 599, overage_cap: 600 }],
] as const;

function standingStatusBehaviour(ledgerOf: LedgerOf): void {
  it.each(standings)('reads the standing of its org as %s', async (standing, books) => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      account.fund('acme', books);
    });

    expect(await metered.status()).toMatchObject({ standing, summary: someWords });
  });
}

export function statusBehaviour(ledgerOf: LedgerOf): void {
  keylessStatusBehaviour(ledgerOf);
  unreadStatusBehaviour(ledgerOf);
  licensedStatusBehaviour(ledgerOf);
  standingStatusBehaviour(ledgerOf);
  limitedStatusBehaviour(ledgerOf);
}
