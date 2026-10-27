import { expect, it } from 'vitest';

import { inTurn, runOf, runStreamOf } from '../testing/runs.ts';
import { actionsOf, opened, restartedOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';
import { distinctRunsIn, played, randomSteps, seeded } from './random-ledgers.ts';

export function countingBehaviour(ledgerOf: LedgerOf): void {
  it('counts a run once, however often it is started again under its id, and admits it again without holding', async () => {
    const { metered } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.started('run-1');

    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect(await metered.state()).toMatchObject({
      checkpoint: { actions: 1 },
      holds: [{ run: runStreamOf('run-2') }],
    });
  });

  it('counts every run of every org and playbook of the ledger, and nothing of a run refused before it started', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 4 });
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2', 'beta');
    await startedOnceAdmitted(metered, 'run-3', 'gamma', 'globex');

    expect((await metered.admitted(runOf('run-4'))).kind).toBe('admitted');
    expect((await metered.admitted(runOf('run-5'))).kind).toBe('license_required');
    expect(await metered.state()).toMatchObject({ checkpoint: { actions: 3 }, holds: [{ run: runStreamOf('run-4') }] });
  });
}

export function recountingBehaviour(ledgerOf: LedgerOf): void {
  it.each([7, 1009, 65_537])(
    'counts incrementally exactly what a count from the first event counts, over the random ledger of seed %i',
    async (seed) => {
      const { metered, tampering } = await opened(ledgerOf, { allowance: 1000, verifyEvery: 1_000_000 });
      const steps = randomSteps(seeded(seed), 60);
      await inTurn(steps, (step) => played(metered, step));
      await metered.admitted(runOf('last'));
      const incremental = await actionsOf(metered);
      await tampering.streamDeleted('meter');
      await metered.admitted(runOf('last'));

      expect([incremental, await actionsOf(metered)]).toEqual([distinctRunsIn(steps), distinctRunsIn(steps)]);
    },
    60_000,
  );

  it('counts what was started before the ledger was metered', async () => {
    const { metered } = await opened(ledgerOf);
    await metered.started('run-1');
    await metered.started('run-2', 'beta');
    const later = await restartedOf(metered);

    await later.admitted(runOf('run-3'));
    expect(await actionsOf(later)).toBe(2);
  });
}
