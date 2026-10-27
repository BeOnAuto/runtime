import { expect, it } from 'vitest';

import { runOf, runStreamOf } from './metered.ts';
import { opened, restartedOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';

export function rebuildingBehaviour(ledgerOf: LedgerOf): void {
  it('rebuilds its count from the first event once its meter stream is deleted', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    await tampering.streamDeleted('meter');

    expect((await metered.admitted(runOf('run-3'))).kind).toBe('admitted');
    expect(await metered.state()).toMatchObject({ checkpoint: { actions: 2 }, fault: undefined });
  });

  it('rebuilds its count from the first event when its checkpoint was edited without its digest, and says so', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    await metered.admitted(runOf('run-3'));
    const ids = await tampering.idsOf('meter');
    await Promise.all(ids.map((id) => tampering.edited(id, (data) => ({ ...data, actions: 0 }))));

    expect((await metered.admitted(runOf('run-4'))).kind).toBe('admitted');
    expect(await metered.state()).toMatchObject({ checkpoint: { actions: 2 }, fault: undefined });
    expect(metered.warnings()).toEqual([
      'The meter counted its ledger again from the first event: its count was edited',
    ]);
  });
}

export function faultBehaviour(ledgerOf: LedgerOf): void {
  it('faults when the event it counted last is gone, and refuses every run after, through a restart', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    await tampering.deleted(await metered.lastCounted());

    const refused = await metered.admitted(runOf('run-3'));
    expect(refused.kind).toBe('metering_fault');
    expect(refused.detail).toContain('https://studio.on.auto/support');
    const restarted = await restartedOf(metered);
    expect((await restarted.admitted(runOf('run-4'))).kind).toBe('metering_fault');
    expect(await restarted.state()).toMatchObject({ fault: { reason: 'history_removed' } });
  });

  it('faults when another event stands where it counted its last', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    await tampering.renamed(await metered.lastCounted(), 'another/event');

    expect((await metered.admitted(runOf('run-3'))).kind).toBe('metering_fault');
    expect(await metered.state()).toMatchObject({ fault: { reason: 'history_rewritten' } });
  });

  it('faults at its next full verification when events it counted were removed from the middle', async () => {
    const { metered, tampering } = await opened(ledgerOf, { verifyEvery: 4 });
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    expect((await metered.admitted(runOf('run-3'))).kind).toBe('admitted');
    const [firstStart = ''] = await tampering.idsOf(runStreamOf('run-1'));
    await tampering.deleted(firstStart);

    expect((await metered.admitted(runOf('run-4'))).kind).toBe('metering_fault');
    expect(await metered.state()).toMatchObject({ fault: { reason: 'history_removed' } });
  });

  it('refuses as meter_unavailable while its ledger cannot be read, holding nothing for the run', async () => {
    const { metered } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    metered.readsFail();

    expect((await metered.admitted(runOf('run-2'))).kind).toBe('meter_unavailable');
    expect((await metered.state()).holds.map(({ run }) => run)).not.toContain(runStreamOf('run-2'));
  });
}
