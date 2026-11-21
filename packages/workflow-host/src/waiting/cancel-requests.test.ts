import { recordedReaderOf } from '@on.auto/ledger';
import { Conflict, type Context, messageIdOf } from '@on.auto/operations';
import { callKeyText, type StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { waitingRow } from '../calls/call-rows.ts';
import {
  alpha,
  at,
  childStarted,
  playbookCreated,
  recorded,
  recordedWith,
} from '../reaction-testing/playbook-writes.ts';
import { definitionKeyOfTheTests, runAt, startOf, testMachine, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, onSQLite, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { followedHost, followedThroughTheLatest, settledIn } from '../waiting-testing/followed-host.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { resumedWith } from '../waiting-testing/resumed-cancels.ts';
import { parentId, parentRun } from '../waiting-testing/waiting-parent.ts';
import { cancelRequests } from './cancel-requests.ts';
import { mostOpenCallsOfATree } from './waiting-options.ts';
import { executorWaitingOf } from './waiting-parts.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

const askedToCancel = { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed any more' } };

function runOf(type: string, by = 'acme-admin'): Context {
  return { by, at, runId, definitionType: type, definitionName: 'pause', definitionVersion: 1 };
}

const requestStream = `${definitionKeyOfTheTests}runs/${runId}`;

const requestId = messageIdOf(requestStream, 1);

const started = { type: 'run_started', data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} } };

const cancelled = {
  status: 'rejected',
  reason: 'cancelled',
  kind: 'requested',
  detail: 'Not needed any more',
  by: 'acme-admin',
};

interface Fact {
  readonly type: string;
  readonly data: unknown;
}

function asked({ type, data }: Fact, context: Context = runOf('workflow')) {
  return {
    playbook: { org: 'acme', playbook: 'alpha' },
    playbookKey: alpha,
    filedUnder: definitionKeyOfTheTests,
    record: {
      id: requestId,
      cursor: 'c',
      causationId: null,
      correlationId: null,
      stream: `runs/${runId}`,
      version: 1,
      globalPosition: 1,
      type,
      data,
      context,
      recordedAt: at,
    },
  };
}

async function failingConsumer() {
  const { database } = await followedHost();
  return cancelRequests({
    database,
    submitted: () => Effect.fail(new Conflict({ detail: 'The log of the run kept changing' })),
    cancelDeferred: () => Effect.void,
    workflows: 'workflow',
    now: Date.now,
  });
}

const endingOfAnotherCapability = { type: 'run_succeeded', data: { output: null, record: {} } };

function readBy(consumer: ReturnType<typeof cancelRequests>, fact: Fact, context?: Context) {
  const reading = consumer.read(asked(fact, context));
  if (reading === 'unreadable') {
    throw new Error(`The consumer of cancel requests could not read ${fact.type}`);
  }
  return reading;
}

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const key = callKeyText({ runId: parentRun, reference: '/do/0/ask', run: 1 });

const ending = { type: 'run_succeeded', data: { output: 'checked', record: {} } };

const ofTheChild = {
  by: 'playbook:alpha',
  at,
  runId: child,
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

const run = { runId: 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', attributes: {} };

const checks = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-00000000c4ec/';

function callWith(arguments_: StartCall['arguments']): StartCall {
  return {
    kind: 'start_call',
    key: { runId: run.runId, reference: '/do/0/ask', run: 1 },
    function: 'notify',
    arguments: arguments_,
    longestMs: 60_000,
  };
}

const withoutChildren = {
  ...testMachine,
  functions: {
    argumentChecks: {},
    describe: () => 'a function',
    howAWorkflowReachesTheWorld: 'through its functions',
    howAWorkflowStarts: 'through its runtime',
  },
};

describe('a cancel request on a workflow run', () => {
  it('is given to the run, which ends cancelled by who asked, its record caused by the request', async () => {
    const { database, hosted, settled } = await followedHost();
    hosted.know(runId);
    await Effect.runPromise(hosted.host.start(runAt(runId), startOf(pausing)));

    await recordedWith(database.store, requestStream, askedToCancel, {
      context: runOf('workflow'),
      lineage: { causationId: null, correlationId: runId },
    });
    const settlement = await settled(runId);
    const { records } = await Effect.runPromise(
      recordedReaderOf(database.store)(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'run', run: runId },
        { order: 'desc', limit: 1, dataOf: [] },
      ),
    );

    expect(settlement).toEqual(cancelled);
    expect(records[0]).toMatchObject({ stream: `${definitionKeyOfTheTests}run-logs/${runId}`, causationId: requestId });
  });
});

describe('a cancel request on a run of another capability', () => {
  it('is handed to the capability’s cancel, caused by the request', async () => {
    const waiting = recordedWaiting();
    const { database, hosted } = await followedHost({ waiting: waiting.options });

    await recordedWith(database.store, requestStream, askedToCancel, {
      context: runOf('interaction'),
      lineage: { causationId: null, correlationId: 'root-1' },
    });
    const handed = await hosted.whenRead(waiting.deferredCancels, (cancels) => cancels.length > 0);

    expect(handed).toEqual([
      {
        run: { org: 'acme', playbook: 'alpha', id: runId },
        request: { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
        lineage: { causationId: requestId, correlationId: 'root-1' },
      },
    ]);
  });
});

describe('a cancel request recorded before the host started the workflow', () => {
  it('is passed over by the follower, and the start of the run finds it and ends the run cancelled at once', async () => {
    const { database, hosted, settled } = await followedHost();
    hosted.know(runId);
    await recorded(database.store, requestStream, started, runOf('workflow'));
    await recorded(database.store, requestStream, askedToCancel, runOf('workflow'));
    const other = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';
    hosted.know(other);
    await Effect.runPromise(hosted.host.start(runAt(other), startOf(pausing)));
    await recorded(database.store, `${definitionKeyOfTheTests}runs/${other}`, askedToCancel, runOf('workflow'));

    const otherSettled = await settled(other);
    const answer = await Effect.runPromise(hosted.host.start(runAt(runId), startOf(pausing)));
    const settlement = await settled(runId);

    expect([otherSettled, answer, settlement]).toEqual([cancelled, 'started', cancelled]);
    expect(hosted.troubles()).toEqual([]);
  });
});

describe('the consumer of cancel requests', () => {
  it('never skips a request, and fails a delivery the run cannot take now, to be made again', async () => {
    const consumer = readBy(await failingConsumer(), askedToCancel);
    const { deliveries } = await Effect.runPromise(consumer.batchOf(undefined, 100));
    const failure = await Effect.runPromise(Effect.flip(Effect.forEach(deliveries, ({ deliver }) => deliver)));
    const skipped = Effect.forEach(deliveries, (delivery) => delivery.skipped(failure));

    expect([failure.detail, consumer.skippedAfterSweeps]).toEqual(['The log of the run kept changing', Infinity]);
    expect(await Effect.runPromise(Effect.as(skipped, 'nothing skipped'))).toBe('nothing skipped');
  });

  it('makes no delivery of a cancel its caller recorded before the run’s start, nor again of one it made', async () => {
    const consumer = await failingConsumer();
    const beforeTheStart = readBy(consumer, askedToCancel, { by: 'playbook:alpha', at, runId });
    const made = readBy(consumer, askedToCancel);
    const batches = await Effect.runPromise(
      Effect.all([beforeTheStart.batchOf(undefined, 100), made.batchOf('cancel', 100)]),
    );

    expect(batches.map(({ deliveries }) => deliveries)).toEqual([[], []]);
  });

  it('cannot read a request whose context names no run, nor a record that is no request', async () => {
    const consumer = await failingConsumer();

    expect([
      consumer.read(asked(askedToCancel, { by: 'playbook:alpha', at })),
      consumer.read(asked({ type: 'event_published', data: {} })),
      consumer.read(asked(endingOfAnotherCapability, runOf('interaction', 'playbook:alpha'))),
    ]).toEqual(['unreadable', 'unreadable', 'unreadable']);
  });
});

describe('the cancels the follower passed over, given at the first resume after a host takes the workflows', () => {
  it('are each given to its run, cleared once the run took it or had ended, and kept for a run not started', async () => {
    const resumed = await resumedWith(onSQLite, ['acme/alpha/applied', 'acme/alpha/ended', 'acme/alpha/not-started']);

    await resumed.resume();
    await resumed.resume();

    expect([...resumed.given()].toSorted()).toEqual([
      'acme/alpha/applied',
      'acme/alpha/ended',
      'acme/alpha/not-started',
    ]);
    expect(await resumed.pending()).toEqual(['acme/alpha/not-started']);
    expect(resumed.troubles()).toEqual([]);
  });

  it('report a run that could not take its cancel without holding the others, and give it again next', async () => {
    const resumed = await resumedWith(onSQLite, ['acme/alpha/applied', 'acme/alpha/failing']);

    await resumed.resume();
    const keptAfterTheFailure = await resumed.pending();
    resumed.failingNoMore();
    await resumed.resume();
    await resumed.resume();

    expect(keptAfterTheFailure).toEqual(['acme/alpha/failing']);
    expect(resumed.troubles()).toEqual([
      'The cancel asked of acme/alpha/failing could not be given; the next sweep gives it again',
    ]);
    expect(resumed.given().slice(0, 2).toSorted()).toEqual(['acme/alpha/applied', 'acme/alpha/failing']);
    expect(resumed.given().slice(2)).toEqual(['acme/alpha/failing']);
    expect(await resumed.pending()).toEqual([]);
  });
});

describe('the read of the cancels the follower passed over', () => {
  it('goes page after page, a hundred at a time, and again at the next resume when it failed', async () => {
    const runKeys = Array.from({ length: 205 }, (_, index) => `acme/alpha/run-${String(index).padStart(3, '0')}`);
    const resumed = await resumedWith(onSQLite, runKeys);

    resumed.database.failing(true);
    await resumed.resume();
    const givenWhileFailing = resumed.given().length;
    resumed.database.failing(false);
    await resumed.resume();
    await resumed.resume();

    expect(givenWhileFailing).toBe(0);
    expect(resumed.troubles()).toEqual([
      'The cancels the follower passed over could not be read; the next sweep reads them again',
    ]);
    expect([...resumed.given()].toSorted()).toEqual(runKeys);
    expect(await resumed.pending()).toEqual([]);
  });
});

describe('a host that died after it marked a call waiting and before it read the ending of the call’s run', () => {
  it('leaves the answer to the first resume of the next host, which reads the ending the follower passed over', async () => {
    const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
    const database = await openedOn(settings);
    await playbookCreated(database.store, 'alpha');
    const first = await hostedOn(settings, { answer: () => Effect.never });
    first.know(parentId);
    await Effect.runPromise(first.host.start(runAt(parentId), startOf(asking)));
    await recorded(database.store, await childStarted(database.store, child), ending, ofTheChild);
    await followedThroughTheLatest(database, first);
    await first.host.stop();
    await Effect.runPromise(waitingRow(database, key, { child, at: Date.now() }));

    const second = await hostedOn(settings, { answer: () => Effect.never });
    second.know(parentId);
    const settlement = await settledIn(second)(parentId);

    expect(settlement).toEqual({ status: 'succeeded', output: 'checked' });
    expect(first.settlements().get(parentId)).toBeUndefined();
  });
});

describe('the run a call waits for', () => {
  it('is the one its functions derive from the call, and none when they derive none', async () => {
    const { options } = recordedWaiting();
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const derived = executorWaitingOf(database, testMachine, options);
    const underived = executorWaitingOf(database, withoutChildren, options, 5);

    expect([
      derived.childOf(callWith({ to: 'ada' }), run),
      derived.childOf(callWith('ada'), run),
      underived.childOf(callWith({ to: 'ada' }), run),
    ]).toEqual(['notify at /do/0/ask #1', null, null]);
    expect([derived.mostOpen, underived.mostOpen]).toEqual([mostOpenCallsOfATree, 5]);
  });

  it('is cancelled under the definition its functions say the call called, and not where they say none', async () => {
    const { options, cancels } = recordedWaiting();
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const waitedFor = { org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-0000000000c1' };
    const cancelledOn = (machine: typeof testMachine) =>
      executorWaitingOf(database, machine, options).cancelChild({
        child: waitedFor,
        call: callWith({ to: 'ada' }),
        reason: 'deadline',
        lineage: { causationId: null, correlationId: run.runId },
      });

    const receipts = await Effect.runPromise(Effect.all([cancelledOn(testMachine), cancelledOn(withoutChildren)]));

    expect([receipts.at(1), cancels().map(({ run: { definitionType, name } }) => [definitionType, name])]).toEqual([
      'unknown_run',
      [['notifier', 'notify']],
    ]);
  });
});

describe('the answer of a run a call waits for', () => {
  it('is the ending of that run when it names the call, and none while it runs or names no call', async () => {
    const { options } = recordedWaiting();
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const { childAnswerOf } = executorWaitingOf(database, testMachine, options);
    const ofTheChildWaitingParts = {
      by: 'playbook:alpha',
      at,
      runId: 'the-child',
      definitionType: 'workflow',
      definitionName: 'check',
      definitionVersion: 1,
    };
    const calledBy = { runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', reference: '/do/0/ask', run: 1 };
    const checked = { type: 'run_succeeded', data: { output: 'checked', record: {} } };
    const startedWaitingParts = {
      type: 'run_started',
      data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, playbook: 'alpha', input: {} },
    };
    await Promise.all(
      ['answered', 'uncalled', 'running'].map((childWaitingParts) =>
        recorded(database.store, `${checks}runs/${childWaitingParts}`, startedWaitingParts, ofTheChildWaitingParts),
      ),
    );
    await recorded(database.store, `${checks}runs/answered`, checked, { ...ofTheChildWaitingParts, calledBy });
    await recorded(database.store, `${checks}runs/uncalled`, checked, ofTheChildWaitingParts);

    const answers = await Effect.runPromise(
      Effect.all(
        ['answered', 'uncalled', 'running'].map((childWaitingParts) => childAnswerOf(run.runId, childWaitingParts)),
      ),
    );

    expect(answers).toEqual([{ status: 'succeeded', output: 'checked' }, undefined, undefined]);
  });
});
