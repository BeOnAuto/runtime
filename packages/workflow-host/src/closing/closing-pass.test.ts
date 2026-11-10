import { statement } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  bytesOf,
  callsIn,
  endOfTheLog,
  keyOfTheRun,
  openingACallAfterItsRead,
  ranOn,
  runsIn,
} from '../closing-testing/ended-runs.ts';
import type { HostDatabase } from '../database/host-database.ts';
import { closingBounds } from './closed-runs.ts';
import { endedRunsClosed, type ClosingPass, type ClosingPassAsked } from './closing-pass.ts';

const first = '0199a3c4-7d2e-7c1a-9b3f-00000000000a';

const second = '0199a3c4-7d2e-7c1a-9b3f-00000000000b';

const third = '0199a3c4-7d2e-7c1a-9b3f-00000000000c';

const fourth = '0199a3c4-7d2e-7c1a-9b3f-00000000000d';

const { quietMs } = closingBounds;

const nothingCounted: ClosingPass = {
  examined: 0,
  closed: 0,
  calls: 0,
  bytes: 0,
  endsRecovered: 0,
  alreadyClosed: 0,
  going: 0,
  dispatchBehind: 0,
  unsettled: 0,
  callsOpen: 0,
  tooRecent: 0,
  logMissing: 0,
};

function passedOn(database: HostDatabase, asked: Partial<ClosingPassAsked> = {}): Promise<ClosingPass> {
  return Effect.runPromise(
    endedRunsClosed(database, { now: Date.now() + quietMs + 60_000, after: '', dryRun: false, ...asked }),
  );
}

async function written(database: HostDatabase, ...changes: readonly ReturnType<typeof statement>[]): Promise<void> {
  await Effect.runPromise(Effect.forEach(changes, (change) => database.write(change), { discard: true }));
}

describe('a pass that closes the calls of the runs that ended, as an operator asks it', () => {
  it('says in a dry run what it would close, the calls and the bytes it would let go of, and closes nothing', async () => {
    const database = await ranOn([first], [second]);
    const before = await callsIn(database);

    const pass = await passedOn(database, { dryRun: true });

    expect(before.map(({ state }) => state)).toEqual(['answered']);
    expect(pass).toEqual({
      ...nothingCounted,
      examined: 2,
      closed: 1,
      calls: 1,
      bytes: before.reduce((bytes, row) => bytes + bytesOf(row), 0),
      going: 1,
    });
    expect(pass.bytes).toBeGreaterThan(0);
    expect(await callsIn(database)).toEqual(before);
    expect((await runsIn(database)).map(({ closed_at: closedAt }) => closedAt)).toEqual([null, null]);
  });

  it('closes the closable runs among those after the place it is given, a pass at most, answering where the next pass begins, and counts them closed already after', async () => {
    const database = await ranOn([first, second, third]);
    const now = Date.now() + quietMs + 60_000;

    const firstPass = await passedOn(database, { most: 2, now });
    const secondPass = await passedOn(database, { most: 2, now, after: keyOfTheRun(second) });
    const again = await passedOn(database, { now });
    const pastTheLast = await passedOn(database, { now, after: keyOfTheRun(third) });

    expect([firstPass.examined, firstPass.closed, firstPass.next]).toEqual([2, 2, keyOfTheRun(second)]);
    expect([secondPass.examined, secondPass.closed, secondPass.next]).toEqual([1, 1, undefined]);
    expect([again, pastTheLast]).toEqual([{ ...nothingCounted, examined: 3, alreadyClosed: 3 }, nothingCounted]);
    expect((await callsIn(database)).map(({ state, call, result }) => [state, call, result])).toEqual([
      ['closed', null, null],
      ['closed', null, null],
      ['closed', null, null],
    ]);
    expect((await runsIn(database)).map(({ closed_at: closedAt }) => closedAt)).toEqual([now, now, now]);
  });
});

describe('a pass that closes the calls of the runs that ended before this release recorded their end', () => {
  it('closes a run whose end time was never recorded once its log has been quiet long enough, recording the time of its last record', async () => {
    const database = await ranOn([first]);
    await written(database, statement`UPDATE workflow_runs SET ended_time = NULL`);
    const before = Date.now();

    const tooRecent = await passedOn(database, { now: before });
    const closed = await passedOn(database, { now: Date.now(), quietMs: 0 });
    const [run] = await runsIn(database);

    expect([tooRecent.tooRecent, tooRecent.closed, closed.closed, closed.endsRecovered]).toEqual([1, 0, 1, 0]);
    expect(run?.ended_time).toBeLessThanOrEqual(Date.now());
    expect(run?.ended_time).toBeGreaterThan(before - 60_000);
  });

  it('holds back a run whose log holds no record, writing nothing of it, so a pass over it again reads it as before', async () => {
    const database = await ranOn([first]);
    await written(
      database,
      statement`UPDATE workflow_runs SET ended_time = NULL, stream_id = ${'playbook/acme/alpha/run-logs/gone'}`,
    );
    const before = await callsIn(database);

    const pass = await passedOn(database, { now: Date.now(), quietMs: 0 });
    const again = await passedOn(database, { now: Date.now(), quietMs: 0 });

    expect([pass, again]).toEqual([
      { ...nothingCounted, examined: 1, logMissing: 1 },
      { ...nothingCounted, examined: 1, logMissing: 1 },
    ]);
    expect(await callsIn(database)).toEqual(before);
    expect(
      (await runsIn(database)).map(({ ended_time: endedTime, closed_at: closedAt }) => [endedTime, closedAt]),
    ).toEqual([[null, null]]);
  });

  it('recovers the end of a run whose row never recorded it, from its settlement and the version of its log', async () => {
    const database = await ranOn([first]);
    await written(database, statement`UPDATE workflow_runs SET ended_at = NULL, ended_time = NULL`);

    const pass = await passedOn(database, { now: Date.now(), quietMs: 0 });
    const [run] = await runsIn(database);

    expect([pass.closed, pass.endsRecovered]).toEqual([1, 1]);
    expect(run?.ended_at).toBe(await endOfTheLog(database, first));
    expect(run?.closed_at).not.toBeNull();
  });
});

describe('a pass that holds back the runs it may not close', () => {
  it('holds back a run whose dispatch is behind its end, one whose settlement is not recorded, and one with a call open', async () => {
    const database = await ranOn([first, second, third, fourth]);
    await written(
      database,
      statement`UPDATE workflow_runs SET dispatched_through = 0 WHERE run_key = ${keyOfTheRun(first)}`,
      statement`UPDATE workflow_settlements SET settlement = NULL WHERE run_key = ${keyOfTheRun(second)}`,
      statement`UPDATE workflow_calls SET state = 'running' WHERE run_key = ${keyOfTheRun(third)}`,
    );

    const pass = await passedOn(database);

    expect(pass).toMatchObject({ examined: 4, closed: 1, dispatchBehind: 1, unsettled: 1, callsOpen: 1 });
    expect((await callsIn(database)).map(({ state }) => state)).toEqual(['answered', 'answered', 'running', 'closed']);
  });

  it('closes nothing of a run one of whose calls opened after the pass read it, and counts it open', async () => {
    const database = await ranOn([first]);

    const pass = await passedOn(openingACallAfterItsRead(database, first));

    expect([pass.closed, pass.callsOpen]).toEqual([0, 1]);
    expect((await callsIn(database)).map(({ state }) => state).toSorted()).toEqual(['answered', 'running']);
  });
});
