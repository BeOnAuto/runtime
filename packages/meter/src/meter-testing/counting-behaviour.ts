import { expect, it } from 'vitest';

import { runOf, runStreamOf } from '../testing/runs.ts';
import { opened, replicaOf, restartedAfter, runsNamed, startedOnceAdmitted, type LedgerOf } from './opened.ts';

export function countingBehaviour(ledgerOf: LedgerOf): void {
  it('counts a run once as it admits it, however often it is asked again under its id, before or after it starts', async () => {
    const { metered } = await opened(ledgerOf);
    await metered.admitted(runOf('run-1'));
    await metered.admitted(runOf('RUN-1'));
    await metered.started('run-1');
    await metered.admitted(runOf('run-1'));
    await metered.admitted(runOf('run-2'));

    expect((await metered.state()).admitted).toMatchObject({ actions: 2, first_runs: 2, licensed: 0 });
    expect((await metered.state()).recent.map(({ run }) => run)).toEqual([runStreamOf('run-1'), runStreamOf('run-2')]);
  });

  it('counts every run of every org and playbook it admits, and nothing it did not admit', async () => {
    const { metered } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2', 'beta');
    await startedOnceAdmitted(metered, 'run-3', 'gamma', 'globex');
    await metered.started('run-4');

    expect((await metered.state()).admitted.actions).toBe(3);
  });

  it('counts a run asked again once its hold lapsed without its start, as a run asked anew', async () => {
    const { metered } = await opened(ledgerOf, { holdMs: 600_000 });
    await metered.admitted(runOf('run-1'));
    metered.at('2026-10-27T12:10:00.001Z');
    await metered.admitted(runOf('run-1'));

    expect((await metered.state()).admitted.actions).toBe(2);
    expect((await metered.state()).recent).toEqual([{ run: runStreamOf('run-1'), until: '2026-10-27T12:20:00.001Z' }]);
  });

  it('counts each run once while two replicas of one ledger admit and start the same runs at once', async () => {
    const { at, metered } = await opened(ledgerOf);
    const replica = await replicaOf(at);
    const runs = runsNamed('run', 30);
    await Promise.all([
      ...runs.map((run) => startedOnceAdmitted(metered, run)),
      ...runs.map((run) => startedOnceAdmitted(replica, run)),
    ]);

    expect((await metered.state()).admitted.actions).toBe(30);
  }, 60_000);
}

export function historyBehaviour(ledgerOf: LedgerOf): void {
  it('never stops for the history of its runs, deleted or rewritten: it admits on from its own count', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    await startedOnceAdmitted(metered, 'run-3');
    const [first = ''] = await tampering.idsOf(runStreamOf('run-1'));
    const [second = ''] = await tampering.idsOf(runStreamOf('run-2'));
    await tampering.deleted(first);
    await tampering.edited(second, (data) => ({ ...data, rewritten: true }));
    await tampering.streamDeleted(runStreamOf('run-3'));
    const restarted = await restartedAfter(metered, () => Promise.resolve());

    expect(await restarted.admitted(runOf('run-4'))).toEqual({ kind: 'admitted', detail: '' });
    expect((await restarted.state()).admitted.actions).toBe(4);
  });

  it('never stops for a ledger restored from an older copy: it admits on from the count the copy kept', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    const copied = await tampering.lastPosition();
    await startedOnceAdmitted(metered, 'run-2');
    await startedOnceAdmitted(metered, 'run-3');
    const restored = await restartedAfter(metered, () => tampering.restoredTo(copied));

    expect(await restored.admitted(runOf('run-4'))).toEqual({ kind: 'admitted', detail: '' });
    expect((await restored.state()).admitted.actions).toBe(2);
  });

  it('starts again as a new runtime with a ledger wiped of its own record, with an id of its own', async () => {
    const { metered, tampering } = await opened(ledgerOf, { allowance: 1, freeRate: { per_day: 0, per_month: 0 } });
    await startedOnceAdmitted(metered, 'run-1');
    const { installation } = await metered.state();
    const refused = await metered.admitted(runOf('run-2'));
    await tampering.streamDeleted('meter');

    expect([refused.kind, (await metered.admitted(runOf('run-2'))).kind]).toEqual(['license_required', 'admitted']);
    expect((await metered.state()).installation).not.toBe(installation);
  });
}
