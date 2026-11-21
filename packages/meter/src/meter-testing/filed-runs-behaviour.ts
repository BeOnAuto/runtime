import { LedgerLog, type LogPorts } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { expect, it, onTestFinished } from 'vitest';

import { firstStartsIn } from '../counting/first-starts.ts';
import { countedAfter, countedFromTheStart, type Counted, type FirstStartOf } from '../counting/run-starts.ts';
import { METER_STREAM } from '../meter-stream/meter-events.ts';
import type { DatabaseAt } from '../testing/ledgers.ts';
import { appending, runOf, runStreamOf } from '../testing/runs.ts';
import { opened, replicaOf, runsNamed, startedOnceAdmitted, type DatabaseOf } from './opened.ts';

const nothingCounted: Counted = { actions: 0, through: undefined, last: undefined };

const afterTheHold = '2026-10-27T12:10:00.001Z';

async function admissionsIn(at: DatabaseAt): Promise<number> {
  const [row] = await at.rows(
    'SELECT COUNT(*) AS admitted FROM emt_messages WHERE stream_id = ? AND message_type = ?',
    [METER_STREAM, 'action_admitted'],
  );
  return Number(row?.['admitted']);
}

async function readerOf(at: DatabaseAt) {
  const runtime = ManagedRuntime.make(at.layer());
  onTestFinished(() => runtime.dispose());
  const { ledger, log } = await runtime.runPromise(
    Effect.all({ ledger: Effect.service(Ledger), log: Effect.service(LedgerLog) }),
  );
  return {
    log,
    firstStartOf: firstStartsIn(ledger),
    startedWithNoPlaybook: (stream: string) =>
      runtime.runPromise(ledger.execute(stream, appending('run_started', 1), null)),
  };
}

interface Writing {
  readonly settled: () => boolean;
  readonly done: Promise<unknown>;
}

function writingOf(work: Promise<unknown>): Writing {
  const state = { settled: false };
  return { settled: () => state.settled, done: work.then(() => Object.assign(state, { settled: true })) };
}

async function countedUntilSettled(
  log: LogPorts,
  firstStartOf: FirstStartOf,
  from: Counted,
  writing: Writing,
): Promise<Counted> {
  const settledBefore = writing.settled();
  const counted = await countedAfter(log, firstStartOf, from);
  return settledBefore ? counted : countedUntilSettled(log, firstStartOf, counted, writing);
}

export function admittedWhereFiled(databaseOf: DatabaseOf): void {
  it('finds a run started under its definition in its playbook, and admits it without counting or recording it again, within its hold and after', async () => {
    const { at, metered } = await opened(databaseOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-1'));
    metered.at(afterTheHold);
    await metered.admitted(runOf('RUN-1'));

    expect((await metered.state()).admitted.actions).toBe(1);
    expect(await admissionsIn(at)).toBe(1);
  });

  it('records one admission of a run asked again within its hold with no start recorded, and a second once its hold lapsed', async () => {
    const { at, metered } = await opened(databaseOf);
    await metered.admitted(runOf('run-1'));
    await metered.admitted(runOf('run-1'));
    const withinTheHold = await admissionsIn(at);
    metered.at(afterTheHold);
    await metered.admitted(runOf('run-1'));

    expect([withinTheHold, await admissionsIn(at)]).toEqual([1, 2]);
  });

  it('refuses a run whose id a run of another definition holds in its org, in the words of a run id held by another, and records no admission for it', async () => {
    const { at, metered } = await opened(databaseOf);
    await startedOnceAdmitted(metered, 'run-1', 'alpha');

    expect(await metered.admitted(runOf('RUN-1', 'beta'))).toMatchObject({
      detail: 'The run id belongs to a run of another definition or with another input',
    });
    expect(await admissionsIn(at)).toBe(1);
  });

  it('admits a run whose id only a run of another org holds', async () => {
    const { at, metered } = await opened(databaseOf);
    await startedOnceAdmitted(metered, 'run-1', 'alpha', 'umbrella');

    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
    expect(await admissionsIn(at)).toBe(2);
  });

  it('records one admission of one run asked at once on two replicas of one ledger', async () => {
    const { at, metered } = await opened(databaseOf);
    const replica = await replicaOf(at);
    await Promise.all([metered.admitted(runOf('run-1')), replica.admitted(runOf('run-1'))]);

    expect(await admissionsIn(at)).toBe(1);
    expect((await metered.state()).admitted.actions).toBe(1);
  });
}

export function countedWhereFiled(databaseOf: DatabaseOf): void {
  it('counts a start of each of two definitions in two playbooks, each first start answering the playbook it records', async () => {
    const { at, metered } = await opened(databaseOf);
    await startedOnceAdmitted(metered, 'run-1', 'alpha');
    await startedOnceAdmitted(metered, 'run-2', 'beta');
    const { log, firstStartOf } = await readerOf(at);

    expect((await metered.state()).admitted.actions).toBe(2);
    expect((await countedFromTheStart(log)).actions).toBe(2);
    expect((await countedAfter(log, firstStartOf, nothingCounted)).actions).toBe(2);
    expect(
      await Promise.all([firstStartOf(runStreamOf('run-1', 'alpha')), firstStartOf(runStreamOf('run-2', 'beta'))]),
    ).toEqual([
      { version: 1, playbook: 'alpha' },
      { version: 1, playbook: 'beta' },
    ]);
  });

  it('answers no first start of a run’s stream that holds none, and never guesses the playbook of one that records none', async () => {
    const { at, metered } = await opened(databaseOf);
    await metered.noted(runStreamOf('run-1'), 2);
    const { firstStartOf, startedWithNoPlaybook } = await readerOf(at);
    await startedWithNoPlaybook(runStreamOf('run-2'));

    await expect(firstStartOf(runStreamOf('run-1'))).resolves.toBeUndefined();
    await expect(firstStartOf(runStreamOf('run-2'))).rejects.toBeTruthy();
  });

  it('counts each start once from a place it keeps while two writers start runs at once', async () => {
    const { at, metered } = await opened(databaseOf);
    const replica = await replicaOf(at);
    const { log, firstStartOf } = await readerOf(at);
    const runs = runsNamed('run', 10);
    const writing = writingOf(
      Promise.all([
        ...runs.map((run) => startedOnceAdmitted(metered, run)),
        ...runs.map((run) => startedOnceAdmitted(replica, `other-${run}`, 'beta')),
      ]),
    );
    const counted = await countedUntilSettled(log, firstStartOf, nothingCounted, writing);
    await writing.done;

    expect(counted.actions).toBe(20);
    expect((await countedFromTheStart(log)).actions).toBe(20);
  });
}
