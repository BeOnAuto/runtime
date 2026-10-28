import { expect, it } from 'vitest';

import { runOf, runStreamOf } from '../testing/runs.ts';
import { actionsOf, opened, replicaOf, restartedOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';

function runsNamed(prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

export function allowanceBehaviour(ledgerOf: LedgerOf): void {
  it('admits its allowance and refuses the next as license_required, resolved at the page of Studio naming its installation', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 3 });
    const answers = [
      await startedOnceAdmitted(metered, 'run-1'),
      await startedOnceAdmitted(metered, 'run-2'),
      await startedOnceAdmitted(metered, 'run-3'),
    ];
    const refused = await metered.admitted(runOf('run-4'));
    const installation = String((await metered.state()).installation);
    const page = `https://studio.on.auto/licenses?installation=${installation}`;

    expect(answers).toEqual(['admitted', 'admitted', 'admitted']);
    expect(refused).toEqual({
      kind: 'license_required',
      detail: `This runtime has used its 3 free runs. Get a free key at ${page}, then activate it on the runtime and run this again.`,
      resolve_at: page,
      runtime_id: installation,
    });
  });

  it('releases an admission whose run never started once its hold lapses', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 1, holdMs: 600_000 });
    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('license_required');

    metered.at('2026-10-27T12:10:00.001Z');
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect(await metered.state()).toMatchObject({ holds: [{ run: runStreamOf('run-2') }] });
  });

  it('identifies its installation once, and a fresh ledger, as after its ledger was wiped, as another that starts again', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 2 });
    await startedOnceAdmitted(metered, 'run-1');
    const { installation } = await metered.state();
    await startedOnceAdmitted(metered, 'run-2');
    const refused = await metered.admitted(runOf('run-3'));
    const { metered: wiped } = await opened(ledgerOf, { allowance: 2 });

    expect([refused.kind, (await wiped.admitted(runOf('run-3'))).kind]).toEqual(['license_required', 'admitted']);
    expect((await metered.state()).installation).toBe(installation);
    expect((await wiped.state()).installation).not.toBe(installation);
  });
}

export function concurrencyBehaviour(ledgerOf: LedgerOf): void {
  it('admits exactly its 100 actions of 200 asked at once, on two replicas of one ledger', async () => {
    const { at, metered } = await opened(ledgerOf);
    const replica = await replicaOf(at);
    const answers = await Promise.all([
      ...runsNamed('one', 100).map((run) => metered.admitted(runOf(run))),
      ...runsNamed('other', 100).map((run) => replica.admitted(runOf(run))),
    ]);

    expect(answers.filter(({ kind }) => kind === 'admitted')).toHaveLength(100);
    expect(answers.filter(({ kind }) => kind === 'license_required')).toHaveLength(100);
  }, 120_000);

  it('counts each run once while admissions, starts and catch-ups race on two replicas', async () => {
    const { at, metered } = await opened(ledgerOf, { allowance: 1000 });
    const replica = await replicaOf(at, { allowance: 1000 });
    const runs = runsNamed('run', 30);
    await Promise.all([
      ...runs.map((run) => startedOnceAdmitted(metered, run)),
      ...runs.map((run) => startedOnceAdmitted(replica, run)),
    ]);
    await Promise.all([metered.admitted(runOf('last')), replica.admitted(runOf('last'))]);
    const verifying = await restartedOf(replica, { verifyEvery: 1 });

    expect((await verifying.admitted(runOf('later'))).kind).toBe('admitted');
    expect([await actionsOf(verifying), verifying.warnings()]).toEqual([30, []]);
  }, 60_000);
}
