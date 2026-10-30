import { Conflict } from '@on.auto/operations';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  eventBytesOf,
  runLoopOf,
  snapshotOf,
  SplitDecision,
  submissionOf,
  type RunDecider,
  type RunInput,
} from '../index.ts';
import { memoryRunStore } from '../memory/run-store.ts';
import { countingDecider } from '../testing/counting-decider.ts';
import { testCancel } from '../testing/driver-inputs.ts';
import { at, runId, runningState, started } from '../testing/runs.ts';

const cancelled: RunInput = { kind: 'cancel_requested', runId, at: at + 1, cancel: testCancel };

function submitted(store: ReturnType<typeof memoryRunStore>, input: RunInput) {
  return runLoopOf(store, countingDecider)(input.runId, input).pipe(
    Effect.map((decided) => submissionOf(decided, input)),
  );
}

describe('the engine on the ledger loop', () => {
  it('loads the run from its stream, decides, appends one event with the version it read, and answers applied', async () => {
    const store = memoryRunStore();

    const answers = await Effect.runPromise(
      Effect.all([submitted(store, started), submitted(store, cancelled), submitted(store, cancelled)]),
    );

    expect(answers).toEqual([
      { outcome: 'applied', version: 1 },
      { outcome: 'applied', version: 2 },
      { outcome: 'stale', version: 2 },
    ]);
    expect(store.events(runId).map(({ version }) => version)).toEqual([1, 2]);
  });

  it('answers not_started for an input to a run whose start has not arrived, and appends nothing', async () => {
    const store = memoryRunStore();

    expect(await Effect.runPromise(submitted(store, cancelled))).toEqual({ outcome: 'not_started', version: 0 });
    expect([store.events(runId), store.contexts(runId)]).toEqual([[], []]);
  });

  it('appends each event with the context its decider gives for the input, at the time of the input', async () => {
    const store = memoryRunStore();

    await Effect.runPromise(Effect.all([submitted(store, started), submitted(store, cancelled)]));

    const ofTheRun = {
      by: 'counter',
      runId,
      definitionType: 'workflow',
      definitionName: 'counted',
      definitionVersion: 1,
    };

    expect(store.contexts(runId)).toEqual([
      { at: new Date(at).toISOString(), ...ofTheRun },
      { at: new Date(at + 1).toISOString(), ...ofTheRun },
    ]);
  });
});

describe('the engine on the ledger loop, as it appends', () => {
  it('counts the bytes of every event it appends in the state it folds', async () => {
    const store = memoryRunStore();

    const { state } = await Effect.runPromise(runLoopOf(store, countingDecider)(runId, started));

    expect(state.historyBytes).toBe(store.events(runId).reduce((sum, { event }) => sum + eventBytesOf(event), 0));
  });

  it('loads and decides again after a version conflict, and fails with the ledger Conflict after three more', async () => {
    const recovered = memoryRunStore(3);
    const lost = memoryRunStore(4);

    expect(await Effect.runPromise(submitted(recovered, started))).toEqual({ outcome: 'applied', version: 1 });
    expect(await Effect.runPromise(Effect.result(submitted(lost, started)))).toEqual(
      Result.fail(
        new Conflict({ detail: 'The state changed while the command was decided', kind: 'concurrent_change' }),
      ),
    );
  });
});

describe('a decision', () => {
  it('dies on a decision of more than one event and appends nothing, so an input is always one atomic append', async () => {
    const store = memoryRunStore();
    const twice: RunDecider = {
      ...countingDecider,
      decide: (input, state) => Result.map(countingDecider.decide(input, state), (events) => [...events, ...events]),
    };

    const exit = await Effect.runPromise(Effect.exit(runLoopOf(store, twice)(runId, started)));

    expect(exit).toEqual(Exit.die(new SplitDecision({ runId, events: 2 })));
    expect(store.events(runId)).toEqual([]);
  });
});

describe('the run store the tests use', () => {
  it('reads back the events after a version for dispatch, and takes a snapshot', async () => {
    const store = memoryRunStore();
    await Effect.runPromise(Effect.all([submitted(store, started), submitted(store, cancelled)]));

    const after = await Effect.runPromise(store.eventsAfter(runId, 1));

    expect(after.map(({ version }) => version)).toEqual([2]);
    await Effect.runPromise(store.saveSnapshot(snapshotOf(runningState, 2)));
  });
});
