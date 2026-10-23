import { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { BoundConsumer, CallConsumer } from '../follower/consumers.ts';
import { alpha, at, recorded } from '../reaction-testing/playbook-writes.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { until } from '../testing/until.ts';
import { recordedWaiting, resultOfEnding } from '../waiting-testing/recorded-waiting.ts';
import { parentId, parentRun, waitingParent } from '../waiting-testing/waiting-parent.ts';
import { childEndings, endedChildrenOn } from './child-endings.ts';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const ofTheChild = {
  by: 'playbook:alpha',
  at,
  runId: child,
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

const succeeded = { type: 'run_succeeded', data: { output: 'checked', record: {} } };

const endingRecord = {
  playbook: { org: 'acme', playbook: 'alpha' },
  playbookKey: alpha,
  record: {
    id: 'record-1',
    cursor: 'record-1',
    causationId: null,
    correlationId: null,
    stream: `runs/${child}`,
    version: 2,
    globalPosition: 2,
    type: succeeded.type,
    data: succeeded.data,
    context: ofTheChild,
    recordedAt: at,
  },
};

describe('the ending of a run that answers a call', () => {
  it('is delivered by the follower to the step that waits for it, as its answer, and the call is answered', async () => {
    const { database, settled, answeredCalls } = await waitingParent(child);

    await recorded(database.store, `${alpha}runs/${child}`, succeeded, ofTheChild);

    expect(await settled(parentId)).toEqual({ status: 'succeeded', output: 'checked' });
    expect(await answeredCalls()).toEqual([{ state: 'answered', delivered: 1 }]);
  });

  it('is a receipt and no failure when it reaches a call that is closed, as when it is delivered again', async () => {
    const mapped: string[] = [];
    const waiting = recordedWaiting();
    const { database, hosted, settled } = await waitingParent(child, {
      waiting: {
        ...waiting.options,
        resultOf: (ending) => {
          mapped.push(ending.type);
          return resultOfEnding(ending);
        },
      },
    });

    await recorded(database.store, `${alpha}runs/${child}`, succeeded, ofTheChild);
    await recorded(database.store, `${alpha}runs/${child}`, succeeded, ofTheChild);
    await recorded(database.store, `${alpha}runs/${child}x`, { type: 'run_failed', data: {} }, ofTheChild);
    await settled(parentId);
    await until(
      (): readonly string[] => mapped,
      (types) => types.includes('run_failed'),
    );

    expect(mapped).toContain('run_failed');
    expect(hosted.troubles()).toEqual([]);
  });
});

function endingReadBy(consumer: CallConsumer): BoundConsumer {
  const reading = consumer.read(endingRecord);
  if (reading === 'unreadable') {
    throw new Error('The consumer of child endings could not read the ending');
  }
  return reading;
}

describe('a delivery of an ending that the run cannot take now', () => {
  it('fails, to be made again, by a consumer that never skips a delivery', async () => {
    const { database } = await waitingParent(child);
    const consumer = endingReadBy(
      childEndings({
        database,
        submitted: () => Effect.fail(new Conflict({ detail: 'The log of the run kept changing' })),
        resultOf: resultOfEnding,
        now: () => 1,
      }),
    );

    const { deliveries } = await Effect.runPromise(consumer.batchOf(undefined, 100));
    const failure = await Effect.runPromise(Effect.flip(Effect.forEach(deliveries, ({ deliver }) => deliver)));
    const skipped = Effect.forEach(deliveries, (delivery) => delivery.skipped(''));
    const resumed = await Effect.runPromise(consumer.batchOf('call', 100));

    expect([failure.detail, consumer.skippedAfterSweeps]).toEqual(['The log of the run kept changing', Infinity]);
    expect(resumed.deliveries).toEqual([]);
    expect(await Effect.runPromise(Effect.as(skipped, 'nothing skipped'))).toBe('nothing skipped');
  });
});

describe('the endings of the runs a run waits for, before a timer of that run fires', () => {
  it('are delivered first, so a child that ended while the server was down answers before the deadline', async () => {
    const { database, callStates } = await waitingParent(child);
    await recorded(database.store, `${alpha}runs/${child}`, { type: 'run_started', data: { input: {} } }, ofTheChild);
    const submitted: unknown[] = [];
    const endedChildren = endedChildrenOn({
      database,
      submitted: (input) =>
        Effect.sync(() => {
          submitted.push(input);
          return { outcome: 'applied', version: 2 };
        }),
      resultOf: resultOfEnding,
      now: () => 1,
    });

    await Effect.runPromise(endedChildren(parentRun));
    const whileGoing = submitted.length;
    await recorded(
      database.store,
      `${alpha}runs/${child}`,
      { type: 'run_rejected', data: { rejection: { reason: 'cancelled', detail: 'Expired', kind: 'deadline' } } },
      ofTheChild,
    );
    await Effect.runPromise(endedChildren(parentRun));

    expect(whileGoing).toBe(0);
    expect(submitted).toEqual([
      {
        kind: 'call_answered',
        runId: parentRun,
        at: 1,
        key: { runId: parentRun, reference: '/do/0/ask', run: 1 },
        result: { status: 'rejected', reason: 'cancelled', detail: 'Expired' },
      },
    ]);
    expect(await callStates()).toEqual([{ state: 'answered', delivered: 1 }]);
  });
});

describe('the endings of the runs a run waits for, when its calls cannot be read', () => {
  it('fail the fire of its timer, so the timer fires again at the next sweep', async () => {
    const { database } = await waitingParent(child);
    const reading = faultyDatabase(database);
    reading.failing(true);
    const endedChildren = endedChildrenOn({
      database: reading,
      submitted: () => Effect.die(new Error('Nothing is submitted')),
      resultOf: resultOfEnding,
      now: () => 1,
    });

    expect(await Effect.runPromise(Effect.flip(endedChildren(parentRun)))).toMatchObject({
      detail: 'The database was told to fail',
    });
  });
});
