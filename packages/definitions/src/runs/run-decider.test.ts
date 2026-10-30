import { Conflict, type Context } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand, RunResult } from './run-commands.ts';
import { runDecider, runStreamNameOf } from './run-decider.ts';
import type { RecordedRunEvent, RunEvent } from './run-events.ts';
import { startedRunOf } from './run-state.ts';

const start = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const finish = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const ofGreet = { definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };

const greeting = { definition_type: 'echo', name: 'greet', input: { who: 'Ada', tags: ['a', 'b'] } };

const started: RunEvent = { type: 'run_started', data: { started_by: recordedAdmin, input: greeting.input } };

const succeeded: RunResult = { type: 'run_succeeded', data: { output: 'Hello Ada', record: { model: 'x' } } };

const rejectedInput: RunResult = {
  type: 'run_rejected',
  data: {
    rejection: {
      reason: 'invalid_input',
      detail: 'No',
      issues: [{ detail: 'Expected a name', pointer: '/input/who' }],
    },
  },
};

const unavailable: RunResult = {
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'The model is busy' } },
};

const conflicted: RunResult = {
  type: 'run_rejected',
  data: { rejection: { reason: 'conflict', detail: 'The model takes no seed; update the definition' } },
};

const failed: RunResult = { type: 'run_failed', data: {} };

const atTheStart: Context = { ...start, ...ofGreet };

const atTheFinish: Context = { ...finish, ...ofGreet };

const startedAt = recordedWith(atTheStart);

const finishedAt = recordedWith(atTheFinish);

function stateAfter(...events: readonly RecordedRunEvent[]) {
  return runStateAfter(events);
}

function decided(command: RunCommand, ...history: readonly RecordedRunEvent[]) {
  return runDecider.decide(command, stateAfter(...history));
}

function starting(request: object = {}, version = 1): RunCommand {
  return {
    type: 'start',
    ...greeting,
    started_by: recordedAdmin,
    calls_tools: false,
    ...request,
    definition_version: version,
    ...start,
  };
}

function finishing(result: RunResult): RunCommand {
  return { type: 'finish', result, ...finish };
}

const anotherRequest = new Conflict({
  detail: 'The run id belongs to a run of another definition or with another input',
});

describe('starting a run', () => {
  it('records the input, with the definition, its version, who started it and when as its context', () => {
    expect(decided(starting())).toStrictEqual(Result.succeed([started]));
    expect(runDecider.context(starting(), runDecider.initialState)).toStrictEqual(atTheStart);
  });

  it('records it again when it never finished, at the version given', () => {
    expect(decided(starting({}, 2), startedAt(started))).toStrictEqual(Result.succeed([started]));
    expect(runDecider.context(starting({}, 2), stateAfter(startedAt(started)))).toMatchObject({
      definitionVersion: 2,
    });
  });

  it('records it again after unavailable, a conflict or a failure, which are no final result', () => {
    expect([
      decided(starting(), startedAt(started), finishedAt(unavailable)),
      decided(starting({}, 2), startedAt(started), finishedAt(conflicted)),
      decided(starting(), startedAt(started), finishedAt(failed)),
    ]).toStrictEqual([Result.succeed([started]), Result.succeed([started]), Result.succeed([started])]);
  });

  it('records nothing once the run has a final result', () => {
    expect(decided(starting(), startedAt(started), finishedAt(succeeded))).toStrictEqual(Result.succeed([]));
    expect(decided(starting(), startedAt(started), finishedAt(rejectedInput))).toStrictEqual(Result.succeed([]));
  });

  it('takes the same input in any key order', () => {
    expect(
      decided(starting({ input: { tags: ['a', 'b'], who: 'Ada' } }), startedAt(started), finishedAt(succeeded)),
    ).toStrictEqual(Result.succeed([]));
  });

  it('is rejected for another type, another definition or another input under the same id', () => {
    expect([
      decided(starting({ definition_type: 'probe' }), startedAt(started)),
      decided(starting({ name: 'wave' }), startedAt(started), finishedAt(succeeded)),
      decided(starting({ input: { who: 'Bob' } }), startedAt(started), finishedAt(failed)),
      decided(starting({ input: { who: 'Ada', tags: ['b', 'a'] } }), startedAt(started)),
    ]).toEqual([
      Result.fail(anotherRequest),
      Result.fail(anotherRequest),
      Result.fail(anotherRequest),
      Result.fail(anotherRequest),
    ]);
  });
});

describe('finishing a run', () => {
  it('records how a started run ended, with who finished it and when as its context', () => {
    const state = stateAfter(startedAt(started));

    expect(decided(finishing(succeeded), startedAt(started))).toStrictEqual(Result.succeed([succeeded]));
    expect(decided(finishing(failed), startedAt(started))).toStrictEqual(Result.succeed([failed]));
    expect(runDecider.context(finishing(failed), state)).toStrictEqual(atTheFinish);
  });

  it('takes the type, the name and the version of the definition the latest attempt ran as its context', () => {
    const state = stateAfter(
      startedAt(started),
      finishedAt(unavailable),
      recordedWith({ ...atTheStart, definitionVersion: 2 })(started),
    );

    expect(runDecider.context(finishing(failed), state)).toStrictEqual({ ...atTheFinish, definitionVersion: 2 });
  });

  it('records the result of another attempt after unavailable or a failure', () => {
    expect(decided(finishing(succeeded), startedAt(started), finishedAt(unavailable))).toStrictEqual(
      Result.succeed([succeeded]),
    );
  });

  it('records nothing once the run has a final result, nor for a run that never started', () => {
    expect([
      decided(finishing(failed), startedAt(started), finishedAt(succeeded)),
      decided(finishing(failed), startedAt(started), finishedAt(rejectedInput)),
      decided(finishing(failed)),
    ]).toStrictEqual([Result.succeed([]), Result.succeed([]), Result.succeed([])]);
    expect(runDecider.context(finishing(failed), runDecider.initialState)).toStrictEqual(finish);
  });
});

const recordedState = {
  attempt: 1,
  finishesLater: false,
  deferred: false,
  callsTools: false,
  resumes: false,
  lastCall: 0,
  lastModelCall: 0,
  openCalls: new Set(),
  openModelCalls: new Set(),
  mayHaveChanged: false,
  calledOnlyReadOnly: true,
  answer: null,
  work: [],
  depth: 0,
  callDepth: 0,
};

describe('a run', () => {
  it('lives in a stream of its own, named after its id', () => {
    expect(runStreamNameOf(testRunId)).toBe(`runs/${testRunId}`);
  });

  it('starts unknown and holds its input and how its latest attempt went', () => {
    expect(stateAfter()).toBeUndefined();
    expect(stateAfter(startedAt(started), finishedAt(unavailable))).toStrictEqual({
      input: greeting.input,
      run: {
        type: 'echo',
        name: 'greet',
        definition_version: 1,
        status: 'rejected',
        rejection: { reason: 'unavailable', detail: 'The model is busy' },
        started_at: start.at,
        started_by: recordedAdmin,
        finished_at: finish.at,
      },
      ...recordedState,
      result: { type: 'run_rejected', data: { rejection: { reason: 'unavailable', detail: 'The model is busy' } } },
    });
  });
});

describe('a run started again', () => {
  it('holds how its latest attempt went, at the version that attempt ran', () => {
    const again = recordedWith({ ...atTheStart, definitionVersion: 2 })(started);

    expect(stateAfter(startedAt(started), finishedAt(unavailable), again, finishedAt(succeeded))).toStrictEqual({
      input: greeting.input,
      run: {
        type: 'echo',
        name: 'greet',
        definition_version: 2,
        status: 'succeeded',
        output: 'Hello Ada',
        started_at: start.at,
        started_by: recordedAdmin,
        finished_at: finish.at,
      },
      ...recordedState,
      record: { model: 'x' },
      result: succeeded,
    });
  });
});

describe('the attempts of a run', () => {
  it('hold a failure without an output or a rejection', () => {
    expect(startedRunOf(stateAfter(startedAt(started), finishedAt(failed)))?.run).toStrictEqual({
      type: 'echo',
      name: 'greet',
      definition_version: 1,
      status: 'failed',
      started_at: start.at,
      started_by: recordedAdmin,
      finished_at: finish.at,
    });
  });

  it('are ignored when the run was never seen to start', () => {
    expect(stateAfter(finishedAt(succeeded), finishedAt(failed))).toBeUndefined();
  });

  it('refuse a start recorded without its definition, which no run is without', () => {
    expect(() => recordedWith(start)(started)).toThrow('definitionType');
  });
});
