import type { ArmTimer } from '@on.auto/workflow-engine';
import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { runKey, startedAt } from '../suite-testing/probe-subjects.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { armedByOf, sqlTimers } from './sql-timers.ts';

const run = { runId: runKey, attributes: {} };

const armedBy = { version: 3 };

function timerDue(timerId: string, dueAt: number): ArmTimer {
  return { kind: 'arm_timer', runId: runKey, timerId, dueAt, purpose: 'wait' };
}

describe('the timers of the host', () => {
  it('tell when the next armed timer is due, and when none is', async () => {
    const armed: number[] = [];
    const table = sqlTimers(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), (dueAt) => {
      armed.push(dueAt);
    });

    const none = await Effect.runPromise(table.nextDueAt());
    await Effect.runPromise(table.timers.arm(timerDue('1', startedAt + 2000), run, armedBy));
    await Effect.runPromise(table.timers.arm(timerDue('2', startedAt + 1000), run, armedBy));
    const next = await Effect.runPromise(table.nextDueAt());

    expect([none, next, armed]).toEqual([null, startedAt + 1000, [startedAt + 2000, startedAt + 1000]]);
  });
});

describe('the timers of the host, once armed', () => {
  it('keep the version of the record that armed each timer, and none for a timer a sweep armed again', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const table = sqlTimers(database, Function.constVoid);
    await Effect.runPromise(table.timers.arm(timerDue('1', startedAt), run, armedBy));
    await Effect.runPromise(table.timers.sweep(run, [timerDue('2', startedAt)]));

    expect(
      await Effect.runPromise(
        Effect.all([
          armedByOf(database, runKey, '1'),
          armedByOf(database, runKey, '2'),
          armedByOf(database, runKey, '3'),
        ]),
      ),
    ).toEqual([3, null, null]);
  });

  it('put off a timer that could not fire, so it is due again later', async () => {
    const table = sqlTimers(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), Function.constVoid);
    await Effect.runPromise(table.timers.arm(timerDue('1', startedAt), run, armedBy));

    await Effect.runPromise(table.postponed({ runKey, timerId: '1' }, startedAt + 50));

    expect(await Effect.runPromise(table.due(startedAt, 10))).toEqual([]);
    expect(await Effect.runPromise(table.due(startedAt + 50, 10))).toEqual([{ runKey, timerId: '1' }]);
  });

  it('fail an arm, a cancel or a sweep they cannot record, to be dispatched again', async () => {
    const database = faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const { timers } = sqlTimers(database, Function.constVoid);
    database.failing(true);

    const failures = await Effect.runPromise(
      Effect.all([
        Effect.flip(timers.arm(timerDue('1', startedAt), run, armedBy)),
        Effect.flip(timers.cancel({ kind: 'cancel_timer', runId: runKey, timerId: '1' }, run)),
        Effect.flip(timers.sweep(run, [timerDue('1', startedAt)])),
      ]),
    );

    expect(failures).toEqual([
      expect.objectContaining({ output: 'arm_timer' }),
      expect.objectContaining({ output: 'cancel_timer' }),
      expect.objectContaining({ output: 'arm_timer' }),
    ]);
  });
});
