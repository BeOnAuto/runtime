import { expect, it } from 'vitest';

import { runOf } from '../testing/runs.ts';
import {
  admittedEach,
  licensedInstallation,
  licensedOn,
  opened,
  restartedAfter,
  runsNamed,
  startedOnceAdmitted,
  type LedgerOf,
} from './opened.ts';

const installation = licensedInstallation;

function takenReportBehaviour(ledgerOf: LedgerOf): void {
  it('reports the runs it admitted and those it admitted against its license, and takes the license Auto answers', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await admittedEach(metered, ['run-1', 'run-2']);
    metered.account.at('2026-10-27T13:00:00.000Z');
    metered.at('2026-10-27T13:00:00.000Z');

    expect(await metered.reported()).toEqual({ kind: 'reported', detail: '' });
    expect(metered.account.reports()).toEqual([{ actions: 2, licensed: 2 }]);
    expect(await metered.state()).toMatchObject({
      reported: { actions: 2, licensed: 2 },
      license: {
        issued_at: '2026-10-27T13:00:00.000Z',
        charged_through: 2,
        admits_through: 1000,
        credits: { available: 998, owed: 0, overage_cap: 0 },
        licensed_reported: 2,
        taken_at: '2026-10-27T13:00:00.000Z',
      },
    });
  });

  it('keeps its last license and admits on it while Auto cannot be reached, and reports again after', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.goDown();
    const unreached = await metered.reported();
    const admitted = await startedOnceAdmitted(metered, 'run-1');
    metered.account.comeBack();

    expect([unreached.kind, admitted]).toEqual(['meter_unavailable', 'admitted']);
    expect(await metered.reported()).toEqual({ kind: 'reported', detail: '' });
    expect(metered.account.reports()).toEqual([{ actions: 1, licensed: 1 }]);
  });

  it('answers meter_unavailable when it cannot record the license a report brought, and reports again', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.executesFail('conflict');
    const unrecorded = await metered.reported();
    metered.executesFail('nothing');

    expect(unrecorded.kind).toBe('meter_unavailable');
    expect(await metered.reported()).toEqual({ kind: 'reported', detail: '' });
    expect(metered.account.reportsSent()).toBe(2);
  });
}

function keyedReportBehaviour(ledgerOf: LedgerOf): void {
  it('activates its key at a report while it holds no license for it, saying so when Auto refuses the key', async () => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    metered.account.revoke(key, 'key_rotated');
    const keyed = await restartedAfter(metered, () => Promise.resolve(), { key });

    expect(await keyed.reported()).toEqual({ kind: 'reported', detail: '' });
    expect(keyed.warnings().at(-1)).toContain(
      "This runtime could not activate its key with Auto: This runtime's key was replaced.",
    );
    expect((await keyed.state()).refused).toMatchObject({ because: 'key_rotated' });
  });

  it('reports nothing, and calls Auto for nothing, without a key', async () => {
    const { metered } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');

    expect(await metered.reported()).toEqual({ kind: 'reported', detail: '' });
    expect(await metered.reportDue()).toBe(false);
    expect([metered.account.reportsSent(), metered.account.activations()]).toEqual([0, []]);
  });
}

export function reportBehaviour(ledgerOf: LedgerOf): void {
  takenReportBehaviour(ledgerOf);
  keyedReportBehaviour(ledgerOf);
}

export function earlyReportBehaviour(ledgerOf: LedgerOf): void {
  it('is due early once it has used half of what its license left it, and no longer once a report renews it', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      account.fund('acme', { available: 10 });
    });
    await admittedEach(metered, runsNamed('run', 4));
    const beforeHalf = await metered.reportDue();
    await startedOnceAdmitted(metered, 'run-4');
    const atHalf = await metered.reportDue();
    await metered.reported();

    expect([beforeHalf, atHalf, await metered.reportDue()]).toEqual([false, true, false]);
    expect((await metered.state()).license).toMatchObject({ licensed_reported: 5, admits_through: 10 });
  });

  it('is not due early while its license leaves it nothing, nor while it is limited', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      account.fund('acme', { available: 0 });
    });

    expect(await metered.reportDue()).toBe(false);
  });
}

export function restoredReportBehaviour(ledgerOf: LedgerOf): void {
  it('reports the lower count of a ledger restored from an older copy, which Auto charges nothing for, and goes on', async () => {
    const { metered, tampering, key } = await licensedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    const copied = await tampering.lastPosition();
    await admittedEach(metered, ['run-2', 'run-3']);
    await metered.reported();
    const restored = await restartedAfter(metered, () => tampering.restoredTo(copied), { key });
    await restored.reported();

    expect(restored.account.wentBackwards()).toEqual([{ installation, licensed: 1, charged_through: 3 }]);
    expect(restored.account.chargedThrough(installation)).toBe(3);
    expect((await restored.admitted(runOf('run-4'))).kind).toBe('admitted');
  });
}
