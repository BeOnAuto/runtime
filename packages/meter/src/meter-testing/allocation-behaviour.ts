import { expect, it } from 'vitest';

import type { Answering } from '../testing/account-fake.ts';
import type { Metered } from '../testing/metered.ts';
import { runOf } from '../testing/runs.ts';
import { allocationReportBehaviour, allocationReportRefusalBehaviour } from './allocation-report-behaviour.ts';
import { allocatedOn, opened, replicaOf, runsNamed, startedOnceAdmitted, type LedgerOf } from './opened.ts';

const aMonthAndADayLater = '2026-11-27T12:00:00.000Z';

async function licensesPageOf(metered: Metered): Promise<string> {
  return `https://studio.on.auto/licenses?installation=${String((await metered.state()).installation)}`;
}

async function identified(metered: Metered): Promise<string> {
  await metered.admitted(runOf('before'));
  return String((await metered.state()).installation);
}

function allocatedAdmissionBehaviour(ledgerOf: LedgerOf): void {
  it('admits each new run against its allocation without asking Auto, up to its credits, then refuses as credits_exhausted', async () => {
    const { metered } = await allocatedOn(ledgerOf, 2, false);
    const answers = [
      await startedOnceAdmitted(metered, 'run-1'),
      await startedOnceAdmitted(metered, 'run-1'),
      await startedOnceAdmitted(metered, 'run-2'),
    ];
    const refused = await metered.admitted(runOf('run-3'));
    const page = await licensesPageOf(metered);

    expect(answers).toEqual(['admitted', 'admitted', 'admitted']);
    expect(refused).toEqual({
      kind: 'credits_exhausted',
      detail: `This runtime has used all 2 offline credits. An owner can request more at ${page}.`,
      because: 'none_left',
      resolve_at: page,
      runtime_id: String((await metered.state()).installation),
    });
    expect([metered.account.reportsSent(), metered.account.activations()]).toEqual([0, []]);
    expect((await metered.state()).admitted).toMatchObject({ actions: 2, licensed: 0, first_runs: 0 });
  });

  it('counts against its allocation only what was run after it was received', async () => {
    const { metered } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    const allocation = metered.account.allocationFor(String((await metered.state()).installation), 1);

    expect(await metered.allocated(allocation)).toEqual({ kind: 'allocated', detail: '' });
    expect((await metered.admitted(runOf('run-3'))).kind).toBe('admitted');
    expect((await metered.admitted(runOf('run-4'))).kind).toBe('credits_exhausted');
    expect((await metered.state()).allocation).toMatchObject({ actions: 2, credits: 1 });
  });
}

function graceBehaviour(ledgerOf: LedgerOf): void {
  it('refuses as license_invalid once the 30 days it was signed for have passed, and a refresh with Auto extends it', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5);
    await startedOnceAdmitted(metered, 'run-1');
    metered.at(aMonthAndADayLater);
    metered.account.at(aMonthAndADayLater);
    const refused = await metered.admitted(runOf('run-2'));
    await metered.refreshed();

    const page = await licensesPageOf(metered);
    expect(refused).toEqual({
      kind: 'license_invalid',
      detail: `These offline credits stopped on 2026-11-26. An owner can request new ones at ${page}.`,
      resolve_at: page,
      runtime_id: String((await metered.state()).installation),
    });
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect((await metered.state()).allocation?.refresh_by).toBe('2026-12-27T12:00:00.000Z');
  });

  it('takes the 90 days an allocation was signed for, and keeps them as it is refreshed', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5, true, 90);
    metered.at(aMonthAndADayLater);
    metered.account.at(aMonthAndADayLater);
    const admitted = await startedOnceAdmitted(metered, 'run-1');
    await metered.refreshed();

    expect(admitted).toBe('admitted');
    expect((await metered.state()).allocation?.refresh_by).toBe('2027-02-25T12:00:00.000Z');
  });

  it('admits exactly its credits of the actions asked at once on two replicas of one ledger', async () => {
    const { at, metered } = await allocatedOn(ledgerOf, 20, false);
    const replica = await replicaOf(at);
    const answers = await Promise.all([
      ...runsNamed('one', 20).map((run) => metered.admitted(runOf(run))),
      ...runsNamed('other', 20).map((run) => replica.admitted(runOf(run))),
    ]);

    expect(answers.filter(({ kind }) => kind === 'admitted')).toHaveLength(20);
    expect(answers.filter(({ kind }) => kind === 'credits_exhausted')).toHaveLength(20);
  }, 120_000);
}

const notAuto: readonly (readonly [string, Answering, string])[] = [
  ['signed by another key under the kid of Auto’s', 'by another key', 'not ones Auto signed'],
  ['tampered with after it was signed', 'tampered', 'not ones Auto signed'],
  ['for another runtime', 'for another installation', 'are for the runtime another-installation'],
];

function allocationRefusalBehaviour(ledgerOf: LedgerOf): void {
  it.each(notAuto)('refuses an allocation %s as license_invalid', async (_, how, why) => {
    const { metered } = await opened(ledgerOf);
    const ours = await identified(metered);
    metered.account.answer(how);
    const refused = await metered.allocated(metered.account.allocationFor(ours, 5));

    expect(refused.kind).toBe('license_invalid');
    expect(refused.detail).toContain(why);
    expect((await metered.state()).allocation).toBeUndefined();
  });

  it('refuses an allocation whose grace has passed, and takes one again only once', async () => {
    const { metered, allocation } = await allocatedOn(ledgerOf, 5);
    const again = await metered.allocated(allocation);
    metered.at(aMonthAndADayLater);

    expect(again.kind).toBe('allocated');
    expect((await metered.allocated(allocation)).detail).toBe(
      `These offline credits stopped on 2026-11-26. An owner can request new ones at ${await licensesPageOf(metered)}.`,
    );
    expect((await metered.state()).allocation?.sequence).toBe(0);
  });
}

function withdrawalBehaviour(ledgerOf: LedgerOf): void {
  it('gives an allocation Auto closed up as it refreshes, and admits by its key or its free runs from then on', async () => {
    const { metered, allocation } = await allocatedOn(ledgerOf, 5);
    const id = String((await metered.state()).allocation?.id);
    metered.account.closeAllocation(id);
    await metered.refreshed();

    expect((await metered.state()).allocation?.withdrawn).toBe('The allocation is closed');
    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
    expect((await metered.state()).admitted).toMatchObject({ first_runs: 1 });
    expect((await metered.allocated(allocation)).detail).toContain(`its offline credits ${id} were withdrawn`);
  });

  it('keeps its allocation, saying so, while Auto cannot be reached or answers another', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5);
    metered.account.goDown();
    await metered.refreshed();
    metered.account.comeBack();
    metered.account.answer('tampered');
    await metered.refreshed();

    expect(
      metered.warnings().filter((line) => line.startsWith('This runtime could not refresh its allocation')),
    ).toEqual([
      'This runtime could not refresh its allocation with Auto: The account service could not be reached',
      'This runtime could not refresh its allocation with Auto: the allocation it answered is not this one, signed by Auto',
    ]);
    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
  });
}

export function allocationsBehaviour(ledgerOf: LedgerOf): void {
  allocatedAdmissionBehaviour(ledgerOf);
  graceBehaviour(ledgerOf);
  allocationRefusalBehaviour(ledgerOf);
  withdrawalBehaviour(ledgerOf);
  allocationReportBehaviour(ledgerOf);
  allocationReportRefusalBehaviour(ledgerOf);
}
