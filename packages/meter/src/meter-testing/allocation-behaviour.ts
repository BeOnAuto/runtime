import { expect, it } from 'vitest';

import type { Answering } from '../testing/account-fake.ts';
import type { Metered } from '../testing/metered.ts';
import { runOf } from '../testing/runs.ts';
import { allocatedOn } from './allocated.ts';
import { allocationReportBehaviour, allocationReportRefusalBehaviour } from './allocation-report-behaviour.ts';
import { opened, replicaOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';

const aWeekAndADayLater = '2026-11-04T12:00:00.000Z';

function runsNamed(prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

async function identified(metered: Metered): Promise<string> {
  await metered.admitted(runOf('before'));
  return String((await metered.state()).installation);
}

function allocatedAdmissionBehaviour(ledgerOf: LedgerOf): void {
  it('admits each new action against its allocation without asking Auto, up to its credits, then refuses as credits_exhausted', async () => {
    const { metered } = await allocatedOn(ledgerOf, 2, false);
    const answers = [
      await startedOnceAdmitted(metered, 'run-1'),
      await startedOnceAdmitted(metered, 'run-1'),
      await startedOnceAdmitted(metered, 'run-2'),
    ];
    const refused = await metered.admitted(runOf('run-3'));

    expect(answers).toEqual(['admitted', 'admitted', 'admitted']);
    expect(refused.kind).toBe('credits_exhausted');
    expect(refused.detail).toContain('has spent the 2 credits of its allocation');
    expect([metered.account.askedToAdmit(), metered.account.activations()]).toEqual([0, []]);
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
  it('refuses as license_invalid once its grace has passed, and a refresh with Auto extends it', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5);
    await startedOnceAdmitted(metered, 'run-1');
    metered.at(aWeekAndADayLater);
    metered.account.at(aWeekAndADayLater);
    const refused = await metered.admitted(runOf('run-2'));
    await metered.refreshed();

    expect(refused.kind).toBe('license_invalid');
    expect(refused.detail).toContain('was to be refreshed with Auto by 2026-11-03T12:00:00.000Z');
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect((await metered.state()).allocation?.refresh_by).toBe('2026-11-11T12:00:00.000Z');
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
  ['signed by another key under the kid of Auto’s', 'by another key', 'not signed by Auto'],
  ['tampered with after it was signed', 'tampered', 'not signed by Auto'],
  ['for another installation', 'for another installation', 'for the installation another-installation'],
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
    metered.at(aWeekAndADayLater);

    expect(again.kind).toBe('allocated');
    expect((await metered.allocated(allocation)).detail).toContain('was to be refreshed with Auto by');
    expect((await metered.state()).allocation?.sequence).toBe(0);
  });
}

function withdrawalBehaviour(ledgerOf: LedgerOf): void {
  it('gives an allocation Auto closed up as it refreshes, and asks the account to admit from then on', async () => {
    const { metered, allocation } = await allocatedOn(ledgerOf, 5);
    const id = String((await metered.state()).allocation?.id);
    metered.account.closeAllocation(id);
    await metered.refreshed();

    expect((await metered.state()).allocation?.withdrawn).toBe('The allocation is closed');
    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
    expect(metered.account.askedToAdmit()).toBe(1);
    expect((await metered.allocated(allocation)).detail).toContain(`its allocation ${id} was withdrawn`);
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
