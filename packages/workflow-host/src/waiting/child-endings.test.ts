import { type Statement, statementOf } from '@on.auto/ledger';
import { ContentUnavailable, type StartCall } from '@on.auto/workflow-engine';
import { defaultLimits } from '@on.auto/workflow-engine/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import type { BoundConsumer, CallConsumer } from '../follower/consumers.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import { alpha, at, childStarted, childStreamOf, recorded } from '../reaction-testing/playbook-writes.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { until } from '../testing/until.ts';
import { readingMeasured } from '../waiting-testing/measured-reads.ts';
import { recordedWaiting, resultOfEnding } from '../waiting-testing/recorded-waiting.ts';
import { parentId, parentRun, waitingParent } from '../waiting-testing/waiting-parent.ts';
import { type CalledOf, childCancelsOn } from './child-cancels.ts';
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
  filedUnder: 'definition/acme/check/',
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

    await recorded(database.store, await childStarted(database.store, child), succeeded, ofTheChild);

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

    await recorded(database.store, await childStarted(database.store, child), succeeded, ofTheChild);
    await recorded(database.store, await childStarted(database.store, child), succeeded, ofTheChild);
    await recorded(
      database.store,
      await childStarted(database.store, `${child}x`),
      { type: 'run_failed', data: {} },
      ofTheChild,
    );
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

const noTrouble = () => Effect.void;

type ParentDatabase = Awaited<ReturnType<typeof waitingParent>>['database'];

function endingsTheRunCannotTake(database: ParentDatabase) {
  const troubles: string[] = [];
  const consumer = endingReadBy(
    childEndings({
      database,
      submitted: () => Effect.fail(new ContentUnavailable({ detail: 'The store of payloads did not answer' })),
      resultOf: resultOfEnding,
      now: () => 1,
      trouble: (what) =>
        Effect.sync(() => {
          troubles.push(what);
        }),
    }),
  );
  return { consumer, troubles: () => troubles };
}

function endingsTakenBeforeATimer(database: ParentDatabase) {
  const submitted: unknown[] = [];
  const endedChildren = endedChildrenOn({
    database,
    submitted: (input) =>
      Effect.sync(() => {
        submitted.push(input);
        return { outcome: 'applied', version: 2 };
      }),
    resultOf: resultOfEnding,
    now: () => 2,
    trouble: noTrouble,
  });
  return { endedChildren, submitted: () => submitted };
}

const lineage = { causationId: 'step-1', correlationId: 'root-1' };

const childChildCancels = { org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-0000000000c1' };

const callChildCancels: StartCall = {
  kind: 'start_call',
  key: { runId: 'acme/alpha/root-1', reference: '/do/0/ask', run: 1 },
  function: 'notify',
  arguments: { to: 'ada' },
  longestMs: 60_000,
};

const calledOf: CalledOf = ({ function: name, arguments: given }) =>
  typeof given === 'object' ? { type: 'notifier', name } : undefined;

const called = {
  org: 'acme',
  playbook: 'alpha',
  id: childChildCancels.runId,
  definitionType: 'notifier',
  name: 'notify',
};

const childChildEndingReads = '0199a3c4-7d2e-7c1a-9b3f-0000000000c2';

const ofTheChildChildEndingReads = {
  by: 'playbook:alpha',
  at,
  runId: childChildEndingReads,
  definitionType: 'computation',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

const started = {
  type: 'run_started',
  data: {
    started_by: { id: 'acme-admin', name: 'acme-admin' },
    playbook: 'alpha',
    input: { text: 'x'.repeat(100 * 1024) },
  },
};

const timedChild = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

function explained({ strings, values }: Statement): Statement {
  const [first = '', ...rest] = strings;
  return statementOf([`EXPLAIN QUERY PLAN ${first}`, ...rest], values);
}

function readsRecorded(database: HostDatabase) {
  const asked: Statement[] = [];
  const recording: HostDatabase = {
    ...database,
    read: (statement) =>
      Effect.suspend(() => {
        asked.push(statement);
        return database.read(statement);
      }),
  };
  return { recording, asked: (): readonly Statement[] => asked };
}

describe('a delivery of an ending that the run cannot take now', () => {
  it('answers the call’s row and goes on, telling the trouble, and the answer the row keeps is given to the run before its next timer', async () => {
    const { database, callStates } = await waitingParent(child);
    const { consumer, troubles } = endingsTheRunCannotTake(database);
    const { endedChildren, submitted } = endingsTakenBeforeATimer(database);

    const { deliveries } = await Effect.runPromise(consumer.batchOf(undefined, 100));
    await Effect.runPromise(Effect.forEach(deliveries, ({ deliver }) => deliver));
    const kept = await callStates();
    await Effect.runPromise(endedChildren(parentRun));

    expect([consumer.skippedAfterSweeps, troubles().length, kept]).toEqual([
      Infinity,
      1,
      [{ state: 'answered', delivered: 0 }],
    ]);
    expect(submitted()).toEqual([
      {
        kind: 'call_answered',
        runId: parentRun,
        at: 2,
        key: { runId: parentRun, reference: '/do/0/ask', run: 1 },
        result: { status: 'succeeded', output: 'checked' },
      },
    ]);
    expect(await callStates()).toEqual([{ state: 'answered', delivered: 1 }]);
  });
});

describe('a delivery of an ending while the call’s row cannot be read', () => {
  it('fails, to be made again, by a consumer that never skips a delivery', async () => {
    const { database } = await waitingParent(child);
    const reading = faultyDatabase(database);
    reading.failing(true);
    const consumer = endingReadBy(
      childEndings({
        database: reading,
        submitted: () => Effect.die(new Error('Nothing is submitted')),
        resultOf: resultOfEnding,
        now: () => 1,
        trouble: noTrouble,
      }),
    );

    const { deliveries } = await Effect.runPromise(consumer.batchOf(undefined, 100));
    const failure = await Effect.runPromise(Effect.flip(Effect.forEach(deliveries, ({ deliver }) => deliver)));
    const skipped = Effect.forEach(deliveries, (delivery) => delivery.skipped(failure));
    const resumed = await Effect.runPromise(consumer.batchOf('call', 100));

    expect(failure.detail).toBe('The database was told to fail');
    expect(resumed.deliveries).toEqual([]);
    expect(await Effect.runPromise(Effect.as(skipped, 'nothing skipped'))).toBe('nothing skipped');
  });
});

describe('the endings of the runs a run waits for, before a timer of that run fires', () => {
  it('are delivered first, so a child that ended while the server was down answers before the deadline', async () => {
    const { database, callStates } = await waitingParent(child);
    await recorded(
      database.store,
      childStreamOf(child),
      { type: 'run_started', data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} } },
      ofTheChild,
    );
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
      trouble: noTrouble,
    });

    await Effect.runPromise(endedChildren(parentRun));
    const whileGoing = submitted.length;
    await recorded(
      database.store,
      childStreamOf(child),
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
      trouble: noTrouble,
    });

    expect(await Effect.runPromise(Effect.flip(endedChildren(parentRun)))).toMatchObject({
      detail: 'The database was told to fail',
    });
  });
});

describe('an answer a call’s row keeps that its run cannot take, before a timer of that run fires', () => {
  it('fails the fire of the timer, so the call is not timed out while its answer waits to be given', async () => {
    const { database } = await waitingParent(child);
    const failing = { database, resultOf: resultOfEnding, now: () => 1, trouble: noTrouble };
    const unavailable = new ContentUnavailable({ detail: 'The store of payloads did not answer' });
    await recorded(database.store, await childStarted(database.store, child), succeeded, ofTheChild);
    const consumer = endingReadBy(childEndings({ ...failing, submitted: () => Effect.fail(unavailable) }));
    const { deliveries } = await Effect.runPromise(consumer.batchOf(undefined, 100));
    await Effect.runPromise(Effect.forEach(deliveries, ({ deliver }) => deliver));

    const fired = endedChildrenOn({ ...failing, submitted: () => Effect.fail(unavailable) })(parentRun);

    expect(await Effect.runPromise(Effect.flip(fired))).toMatchObject({ detail: unavailable.detail });
  });
});

describe('a cancel of the run a call waits for', () => {
  it('asks for the run to be cancelled with the kind of the cancel and words that say why, naming the definition the call called', async () => {
    const waiting = recordedWaiting();
    const cancel = childCancelsOn(waiting.options.cancel, calledOf);

    await Effect.runPromise(cancel({ child: childChildCancels, call: callChildCancels, reason: 'deadline', lineage }));
    await Effect.runPromise(
      cancel({ child: childChildCancels, call: callChildCancels, reason: 'parent_ended', lineage }),
    );

    expect(waiting.cancels()).toEqual([
      {
        run: called,
        request: {
          kind: 'deadline',
          reason: 'The step that waited for this run ran out of time, so it no longer needs it',
        },
        lineage,
      },
      {
        run: called,
        request: {
          kind: 'parent_ended',
          reason: 'The run that waited for this run ended first, or the branch that waited for it lost a race',
        },
        lineage,
      },
    ]);
  });
});

describe('a cancel of the run of a call that names no definition its functions know', () => {
  it('asks for nothing and answers that no such run can be in the playbook', async () => {
    const waiting = recordedWaiting();
    const cancel = childCancelsOn(waiting.options.cancel, calledOf);

    const receipts = await Effect.runPromise(
      Effect.all([
        cancel({ child: childChildCancels, call: null, reason: 'deadline', lineage }),
        cancel({
          child: childChildCancels,
          call: { ...callChildCancels, arguments: 'ada' },
          reason: 'deadline',
          lineage,
        }),
      ]),
    );

    expect([receipts, waiting.cancels()]).toEqual([['unknown_run', 'unknown_run'], []]);
  });
});

describe('the deadline of a call that waits for a run', () => {
  it('ends the call as a timeout and cancels the run it waited for, as past its deadline', async () => {
    const waiting = recordedWaiting();
    const clock = movedClock(Date.now());
    const { settled, callStates } = await waitingParent(childChildCancels.runId, { clock, waiting: waiting.options });

    clock.moveTo(Date.now() + defaultLimits.longestCallMs + 1);
    const settlement = await settled(parentId);

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The function notify did not finish within 600000 ms, the most it may take, at the step ask.',
      cause: { step: 'do/0/ask', run_id: 'notify at /do/0/ask #1', status: 'timed_out' },
    });
    expect(waiting.cancels().map(({ run, request }) => [run, request.kind])).toEqual([[called, 'deadline']]);
    expect(await callStates()).toEqual([{ state: 'cancelled', delivered: 0 }]);
  });
});

describe('the ending of a run a run waits for, read before a timer of that run fires', () => {
  it('is read as the last fact of the child alone, and none of the input of 100 KiB its start holds', async () => {
    const measured = readingMeasured((await waitingParent(childChildEndingReads)).database);
    await recorded(
      measured.database.store,
      await childStarted(measured.database.store, childChildEndingReads),
      started,
      ofTheChildChildEndingReads,
    );
    await recorded(
      measured.database.store,
      await childStarted(measured.database.store, childChildEndingReads),
      succeeded,
      ofTheChildChildEndingReads,
    );
    const readToRecord = measured.bytesRead();
    const submitted: unknown[] = [];
    const endedChildren = endedChildrenOn({
      database: measured.database,
      submitted: (input) =>
        Effect.sync(() => {
          submitted.push(input);
          return { outcome: 'applied', version: 2 };
        }),
      resultOf: resultOfEnding,
      now: () => 1,
      trouble: () => Effect.void,
    });

    await Effect.runPromise(endedChildren(parentRun));

    expect(submitted).toMatchObject([{ kind: 'call_answered', result: { status: 'succeeded', output: 'checked' } }]);
    expect(measured.bytesRead() - readToRecord).toBe(JSON.stringify(succeeded.data).length);
  });
});

describe('the calls of a run, read before a timer of that run fires', () => {
  it('are read through an index of the run’s calls, never by a scan of every call the host keeps', async () => {
    const { database } = await waitingParent(timedChild);
    const { recording, asked } = readsRecorded(database);
    const endedChildren = endedChildrenOn({
      database: recording,
      submitted: () => Effect.die(new Error('Nothing is submitted')),
      resultOf: resultOfEnding,
      now: () => 1,
      trouble: () => Effect.void,
    });

    await Effect.runPromise(endedChildren(parentRun));
    const plans = await Effect.runPromise(Effect.forEach(asked(), (statement) => database.read(explained(statement))));

    expect(asked()).toHaveLength(2);
    expect(JSON.stringify(plans)).toContain('USING INDEX workflow_calls_unclosed_by_run');
    expect(JSON.stringify(plans)).not.toContain('SCAN workflow_calls');
  });
});
