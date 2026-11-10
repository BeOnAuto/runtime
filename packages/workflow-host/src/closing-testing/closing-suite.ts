import { statement, type Statement } from '@on.auto/ledger';
import type { CallResult } from '@on.auto/operations';
import type { CancelCall, StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { closingBounds } from '../closing/closed-runs.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { closedRow, runId, runKey } from './closing-host.ts';
import { closingOn, failedToRemind, type Closing } from './closing-runs.ts';

const { quietMs } = closingBounds;

const playbook = { org: 'acme', playbook: 'alpha' };

const answeredLate: CallResult = { status: 'succeeded', output: 'answered late' };

const runOfTheCalls = { runId: runKey, attributes: {} };

interface OpenRow {
  readonly state: string;
  readonly delivered: number;
}

const openRows: readonly OpenRow[] = [
  { state: 'running', delivered: 0 },
  { state: 'waiting', delivered: 0 },
  { state: 'answered', delivered: 0 },
];

interface Lost {
  readonly title: string;
  readonly lost: Statement;
}

const lostWatermarks: readonly Lost[] = [
  { title: 'a watermark set back by hand', lost: statement`UPDATE workflow_runs SET dispatched_through = 0` },
  { title: 'a run whose row is gone', lost: statement`DELETE FROM workflow_runs` },
];

function keyOf(reference: string) {
  return { runId: runKey, reference, run: 1 };
}

async function closedADayOn(closing: Closing): Promise<number> {
  const end = await closing.ended();
  await closing.wokenAt(end.at + quietMs);
  return end.version;
}

function closedADayAfterTheEnd(settings: SettingsOf): void {
  it('records the version and the time of the input that ended a run with the append that ends it, and closes its calls a day on, keeping each row and letting go of its payloads', async () => {
    const closing = await closingOn(settings);
    const end = await closing.ended();
    const before = await closing.calls();

    const dueAtTheEnd = await closing.wokenAt(end.at, true);
    const atTheEnd = await closing.calls();
    const dueJustBefore = await closing.wokenAt(end.at + quietMs - 1);
    const justBefore = await closing.calls();
    const dueAtTheClose = await closing.wokenAt(end.at + quietMs);
    const dueAfter = await closing.wokenAt(end.at + quietMs + 1);

    expect(before.map(({ state }) => state)).toEqual(['answered', 'answered']);
    expect(before.flatMap(({ call, attributes, result }) => [call, attributes, result])).not.toContain(null);
    expect([atTheEnd, justBefore]).toEqual([before, before]);
    expect([dueAtTheEnd, dueJustBefore, dueAtTheClose, dueAfter]).toEqual([
      end.at + quietMs,
      end.at + quietMs,
      null,
      null,
    ]);
    expect(await closing.calls()).toEqual([closedRow, closedRow]);
    expect(await closing.run()).toEqual([{ ended_at: end.version, ended_time: end.at, closed_at: end.at + quietMs }]);
    expect(closing.recorded.troubles()).toEqual([]);
  });
}

function heldWhileACallIsOpen(settings: SettingsOf): void {
  it.each(openRows)(
    'keeps the calls of an ended run while one is $state and its answer given $delivered times, and closes them once none is',
    async ({ state, delivered }) => {
      const closing = await closingOn(settings);
      const end = await closing.ended();
      await closing.written(
        statement`UPDATE workflow_calls SET state = ${state}, delivered = ${delivered}
          WHERE run_key = ${runKey} AND call_key LIKE ${'%notify%'}`,
      );

      await closing.wokenAt(end.at + quietMs);
      const whileOpen = await closing.calls();
      await closing.written(statement`UPDATE workflow_calls SET state = 'answered', delivered = 1`);
      await closing.wokenAt(end.at + quietMs + 1);

      expect(whileOpen.map((row) => [row.state, row.call !== null])).toEqual([
        [state, true],
        ['answered', true],
      ]);
      expect(await closing.calls()).toEqual([closedRow, closedRow]);
    },
  );

  it('keeps the calls of an ended run until its settlement is recorded, and closes them once it is', async () => {
    const closing = await closingOn(settings);
    closing.ledgerDown(true);
    const end = await closing.ended();

    await closing.wokenAt(end.at + quietMs);
    const unsettled = await closing.calls();
    closing.ledgerDown(false);
    await closing.wokenAt(end.at + quietMs + 1, true);
    await closing.wokenAt(end.at + quietMs + 2);

    expect(unsettled.map(({ state }) => state)).toEqual(['answered', 'answered']);
    expect(await closing.calls()).toEqual([closedRow, closedRow]);
  });
}

function neverSentTwice(settings: SettingsOf): void {
  it.each(lostWatermarks)(
    'starts nothing and runs no function a second time, for a call that succeeded and one that failed, as it dispatches again a closed run from $title',
    async ({ lost }) => {
      const closing = await closingOn(settings, failedToRemind);
      const version = await closedADayOn(closing);
      const [performed, settleAttempts] = [closing.recorded.calls().length, closing.recorded.settleAttempts()];

      await closing.written(lost);
      const wake = await Effect.runPromise(closing.parts().engine.wake(runKey));
      await Effect.runPromise(closing.parts().executor.idle());

      expect(wake).toEqual({ version, dispatchedThrough: version });
      expect([performed, closing.recorded.calls().length, closing.recorded.settleAttempts()]).toEqual([
        2,
        2,
        settleAttempts,
      ]);
      expect(await closing.calls()).toEqual([closedRow, closedRow]);
      expect(closing.recorded.troubles()).toEqual([]);
    },
  );
}

function refusedOnceClosed(settings: SettingsOf): void {
  it('refuses, once a run is closed, a start and a cancel of a call it never started, recording no row of either, and cancels nothing again for a closed call', async () => {
    const closing = await closingOn(settings);
    const version = await closedADayOn(closing);
    const cancels = closing.cancels();
    const { executor } = closing.parts().executor;
    const never: StartCall = {
      kind: 'start_call',
      key: keyOf('/do/2/never'),
      function: 'notify',
      arguments: { to: 'grace' },
      longestMs: 60_000,
    };
    const cancelOf = (reference: string): CancelCall => ({
      kind: 'cancel_call',
      key: keyOf(reference),
      reason: 'deadline',
    });
    const origin = { version };

    const receipts = await Effect.runPromise(
      Effect.all([
        executor.start(never, runOfTheCalls, origin),
        executor.cancel(cancelOf('/do/3/never'), runOfTheCalls, origin),
        executor.cancel(cancelOf('/do/0/notify'), runOfTheCalls, origin),
        executor.start({ ...never, key: keyOf('/do/0/notify') }, runOfTheCalls, origin),
      ]),
    );

    expect(receipts).toEqual(['refused_after_close', 'already_closed', 'already_closed', 'refused_after_close']);
    expect(await closing.calls()).toEqual([closedRow, closedRow]);
    expect([closing.cancels(), closing.recorded.calls().length]).toEqual([cancels, 2]);
  });
}

function readNothingLetGo(settings: SettingsOf): void {
  it('reads nothing it let go of as it opens again: no call resumed, no answer given again, and an answer for a closed call taken by none', async () => {
    const closing = await closingOn(settings);
    await closedADayOn(closing);

    await closing.opened();
    const resumed = await Effect.runPromise(closing.parts().executor.resume());
    const taken = await Effect.runPromise(
      closing.parts().waitingCallAnswered(playbook, { runId, reference: '/do/0/notify', run: 1 }, answeredLate),
    );

    expect([resumed, taken, closing.recorded.calls().length]).toEqual([0, false, 2]);
    expect(await closing.calls()).toEqual([closedRow, closedRow]);
    expect(closing.recorded.troubles()).toEqual([]);
  });
}

function keptWhenSwitchedOff(settings: SettingsOf): void {
  it('closes nothing and is due for nothing while the closing is switched off, a day after the end and long after', async () => {
    const closing = await closingOn(settings, failedToRemind, false);
    const end = await closing.ended();
    const before = await closing.calls();

    const dueAtTheEnd = await closing.wokenAt(end.at, true);
    const dueADayOn = await closing.wokenAt(end.at + quietMs + 1);
    const dueLongAfter = await closing.wokenAt(end.at + 30 * quietMs, true);

    expect([dueAtTheEnd, dueADayOn, dueLongAfter]).toEqual([null, null, null]);
    expect(await closing.calls()).toEqual(before);
    expect((await closing.run()).map(({ closed_at: closedAt }) => closedAt)).toEqual([null]);
  });
}

export function closingSuite(settings: SettingsOf): void {
  closedADayAfterTheEnd(settings);
  keptWhenSwitchedOff(settings);
  heldWhileACallIsOpen(settings);
  neverSentTwice(settings);
  refusedOnceClosed(settings);
  readNothingLetGo(settings);
}
