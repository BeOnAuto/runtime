import { expect, it } from 'vitest';

import { runOf } from '../testing/runs.ts';
import { admittedEach, opened, replicaOf, runsNamed, startedOnceAdmitted, type LedgerOf } from './opened.ts';

const small = { allowance: 3, freeRate: { per_day: 2, per_month: 3 } };

async function pageOf(metered: Awaited<ReturnType<typeof opened>>['metered']): Promise<string> {
  return `https://studio.on.auto/licenses?installation=${String((await metered.state()).installation)}`;
}

export function allowanceBehaviour(ledgerOf: LedgerOf): void {
  it('admits its first runs without a key, then at the free rate, refusing as license_required past the day’s, saying when it lifts', async () => {
    const { metered } = await opened(ledgerOf, small);
    const admitted = await admittedEach(metered, runsNamed('run', 5));
    const refused = await metered.admitted(runOf('run-5'));
    const page = await pageOf(metered);

    expect(admitted).toEqual(['admitted', 'admitted', 'admitted', 'admitted', 'admitted']);
    expect(refused).toEqual({
      kind: 'license_required',
      detail: `This runtime has used its 3 free runs, and without a key it runs at the free rate of 2 runs a UTC day and 3 a UTC month. It has used today's 2, so it can run again from 2026-10-28 00:00 UTC. To run more, get a free key at ${page}, then activate it on the runtime.`,
      because: 'free_daily_limit',
      resolve_at: page,
      runtime_id: String((await metered.state()).installation),
    });
    expect((await metered.state()).admitted).toMatchObject({ actions: 5, first_runs: 3, licensed: 0 });
  });

  it('admits again the next UTC day, up to the month’s, then refuses as license_required until the next UTC month', async () => {
    const { metered } = await opened(ledgerOf, small);
    await admittedEach(metered, runsNamed('run', 5));
    metered.at('2026-10-28T00:00:00.000Z');
    const nextDay = await startedOnceAdmitted(metered, 'run-5');
    const refused = await metered.admitted(runOf('run-6'));
    metered.at('2026-10-31T23:59:59.999Z');
    const lastDay = await metered.admitted(runOf('run-6'));
    metered.at('2026-11-01T00:00:00.000Z');

    expect(nextDay).toBe('admitted');
    expect(refused).toMatchObject({ kind: 'license_required', because: 'free_month_used' });
    expect(refused.detail).toContain("It has used this month's 3, so it can run again from 2026-11-01 00:00 UTC.");
    expect(lastDay.kind).toBe('license_required');
    expect((await metered.admitted(runOf('run-6'))).kind).toBe('admitted');
  });
}

export function laggingClockBehaviour(ledgerOf: LedgerOf): void {
  it('counts a free run dated before the day it counted, as on a replica whose clock lags, toward that day alone', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 0, freeRate: { per_day: 5, per_month: 9 } });
    metered.at('2026-10-28T09:00:00.000Z');
    await startedOnceAdmitted(metered, 'ahead');
    metered.at('2026-10-27T23:59:00.000Z');
    await startedOnceAdmitted(metered, 'behind');

    expect((await metered.state()).admitted).toMatchObject({
      free_day: { period: '2026-10-28', runs: 1 },
      free_month: { period: '2026-10', runs: 2 },
    });
  });
}

export function defaultAllowanceBehaviour(ledgerOf: LedgerOf): void {
  it('runs 100 first runs and then 15 a UTC day and 75 a UTC month by default, with no call to Auto', async () => {
    const { metered } = await opened(ledgerOf);
    const admitted = await admittedEach(metered, runsNamed('run', 115));
    const refused = await metered.admitted(runOf('run-115'));

    expect(admitted.filter((kind) => kind === 'admitted')).toHaveLength(115);
    expect(refused).toMatchObject({ kind: 'license_required', because: 'free_daily_limit' });
    expect(refused.detail).toContain(
      'used its 100 free runs, and without a key it runs at the free rate of 15 runs a UTC day and 75 a UTC month',
    );
    expect([metered.account.activations(), metered.account.reportsSent()]).toEqual([[], 0]);
  }, 120_000);
}

export function concurrencyBehaviour(ledgerOf: LedgerOf): void {
  it('admits exactly its first runs and the day’s free rate of 60 asked at once, on two replicas of one ledger', async () => {
    const tight = { allowance: 20, freeRate: { per_day: 10, per_month: 75 } };
    const { at, metered } = await opened(ledgerOf, tight);
    const replica = await replicaOf(at, tight);
    const answers = await Promise.all([
      ...runsNamed('one', 30).map((run) => metered.admitted(runOf(run))),
      ...runsNamed('other', 30).map((run) => replica.admitted(runOf(run))),
    ]);

    expect(answers.filter(({ kind }) => kind === 'admitted')).toHaveLength(30);
    expect(answers.filter(({ kind }) => kind === 'license_required')).toHaveLength(30);
    expect((await metered.state()).admitted).toMatchObject({ actions: 30, first_runs: 20 });
  }, 120_000);
}
