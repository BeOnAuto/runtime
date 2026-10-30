import { expect, it } from 'vitest';

import { runOf } from '../testing/runs.ts';
import { allocatedOn, opened, restartedAfter, startedOnceAdmitted, type LedgerOf } from './opened.ts';

function madeReportBehaviour(ledgerOf: LedgerOf): void {
  it('makes reports numbered one after another, each of all it spent under its allocation and signed with its key', async () => {
    const { metered, key } = await allocatedOn(ledgerOf, 5);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    const first = await metered.madeReport();
    const named = String((await metered.state()).allocation?.id);
    await startedOnceAdmitted(metered, 'run-3');
    const second = await metered.madeReport(named);
    const { id = '', installation = '' } = { ...(await metered.state()).allocation };

    expect([first.report, second.report]).toEqual([
      { allocation: id, installation, sequence: 1, spent: 2, at: '2026-10-27T12:00:00.000Z' },
      { allocation: id, installation, sequence: 2, spent: 3, at: '2026-10-27T12:00:00.000Z' },
    ]);
    expect(first.signature).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.signature).not.toBe(first.signature);
    expect(key.split('.')).toHaveLength(4);
  });

  it('sends its report to Auto as it reports, which takes it', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.reported();

    expect(
      metered.account.allocationReports().map(({ report, taken }) => [report.sequence, report.spent, taken]),
    ).toEqual([[1, 1, 'taken']]);
  });
}

function restoredReportBehaviour(ledgerOf: LedgerOf): void {
  it('reports the lower count of a ledger restored from an older copy, under a number it used, which Auto freezes', async () => {
    const { metered, tampering, key } = await allocatedOn(ledgerOf, 5);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.reported();
    const copied = await tampering.lastPosition();
    await startedOnceAdmitted(metered, 'run-2');
    await startedOnceAdmitted(metered, 'run-3');
    await metered.reported();
    const restored = await restartedAfter(metered, () => tampering.restoredTo(copied), { key });
    await restored.reported();

    expect(
      metered.account.allocationReports().map(({ report, taken }) => [report.sequence, report.spent, taken]),
    ).toEqual([
      [1, 1, 'taken'],
      [2, 3, 'taken'],
      [2, 1, 'frozen'],
    ]);
    expect(restored.warnings()).toContain(
      `Auto did not take the report 2 of the allocation ${String((await restored.state()).allocation?.id)}: frozen`,
    );
  });
}

export function allocationReportBehaviour(ledgerOf: LedgerOf): void {
  madeReportBehaviour(ledgerOf);
  restoredReportBehaviour(ledgerOf);
}

export function allocationReportRefusalBehaviour(ledgerOf: LedgerOf): void {
  it('answers meter_unavailable when it cannot record an allocation or a report', async () => {
    const { metered, allocation } = await allocatedOn(ledgerOf, 5);
    metered.executesFail('conflict');

    expect([(await metered.allocated(allocation)).kind, (await metered.refusedReport()).kind]).toEqual([
      'meter_unavailable',
      'meter_unavailable',
    ]);
  });

  it('makes no report without an allocation, nor without a key to sign it with', async () => {
    const { metered } = await opened(ledgerOf, { key: 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f.c2VjcmV0' });
    const keyless = await allocatedOn(ledgerOf, 5, false);
    const { metered: keyed } = await allocatedOn(ledgerOf, 5);

    expect((await metered.refusedReport()).detail).toContain('holds no offline credits to report on');
    expect((await keyless.metered.refusedReport()).detail).toContain('holds no license key to sign its report with');
    expect((await keyed.refusedReport('another')).detail).toMatch(
      /^This runtime holds the offline credits [0-9a-f-]+, not another$/u,
    );
  });

  it('says so when it cannot send its report to Auto, and keeps its allocation', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5);
    metered.account.goDown();
    await metered.reported();

    expect(metered.warnings()).toContain(
      'This runtime could not report what it spent of its allocation to Auto: The account service could not be reached',
    );
    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
  });
}
