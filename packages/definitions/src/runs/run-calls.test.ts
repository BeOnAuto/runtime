import { Conflict } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelCallAnswered, modelCallSent, modelCallTimedOut } from '../journal-testing/model-calls.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { CallFact, CallStartedFact, ModelCallFact, RunCommand, ToolCallFact } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import type { RecordedRunEvent, RunEvent } from './run-events.ts';
import { lastCallOf, startedRunOf } from './run-state.ts';

const start = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const ofGreet = { definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };

const atTheStart = recordedWith({ ...start, ...ofGreet });

const atTheFinish = recordedWith({ ...start, ...ofGreet, at: '2026-10-01T09:00:05.000Z' });

const during = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:02.000Z' };

const meanwhile = recordedWith({ ...during, ...ofGreet });

const greeting = { definition_type: 'echo', name: 'greet', input: { who: 'Ada', tags: ['a', 'b'] } };

const started = atTheStart({ type: 'run_started', data: { input: greeting.input } });

const succeeded = atTheFinish({ type: 'run_succeeded', data: { output: 'Hello Ada', record: {} } });

const rejectedInput = atTheFinish({
  type: 'run_rejected',
  data: { rejection: { reason: 'invalid_input', detail: 'No', issues: [] } },
});

const unavailable = atTheFinish({
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'The model is busy' } },
});

const failed = atTheFinish({ type: 'run_failed', data: {} });

function stateAfter(...events: readonly RecordedRunEvent[]) {
  return runStateAfter(events);
}

function decided(command: RunCommand, ...history: readonly RecordedRunEvent[]) {
  return runDecider.decide(command, stateAfter(...history));
}

function starting(): RunCommand {
  return { type: 'start', ...greeting, calls_tools: false, definition_version: 1, ...start };
}

const sent = {
  call_id: 'toolu_01',
  server: 'graph',
  tool: 'search',
  arguments_bytes: 17,
  arguments_sha256: 'a'.repeat(64),
};

const called: CallStartedFact = { type: 'tool_call_started', data: sent };

const answered: ToolCallFact = {
  type: 'tool_call_answered',
  data: {
    number: 1,
    is_error: false,
    result_bytes: 42,
    result_sha256: 'b'.repeat(64),
    duration_ms: 120,
    jsonrpc_id: 3,
  },
};

function recordingCall(fact: CallFact): RunCommand {
  return { type: 'call', fact, ...during };
}

function startOfCall(number: number, readOnly = false): RunEvent {
  return { type: 'tool_call_started', data: { ...sent, ...(readOnly ? { read_only: true } : {}), number } };
}

const callStarted = meanwhile(startOfCall(1));

const callAnswered = meanwhile({ type: 'tool_call_answered', data: { ...answered.data, number: 1 } });

const deferred = meanwhile({ type: 'run_deferred', data: { record: { run: 'x' } } });

const toolsWereCalled = new Conflict({
  detail:
    'The run called tools and did not succeed, so it is not run again under its id, since a tool may have changed something; start a new run with another run id, and read with list_playbook_events, given its run id, what it called',
  kind: 'tools_called',
});

const toolsOnlyRead = new Conflict({
  detail:
    "The run called tools and did not succeed, so it is not run again under its id; every tool it called only reads, by its server's own account, so nothing was changed: start a new run with another run id, and read with list_playbook_events, given its run id, what it called",
  kind: 'tools_called',
  because: 'only_read',
});

const readCalled = meanwhile(startOfCall(1, true));

const noMoreWork = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

describe('a tool call of a run', () => {
  it('is recorded while the run runs, numbered by the decider, with who and when as its context', () => {
    expect(decided(recordingCall(called), started)).toStrictEqual(Result.succeed([startOfCall(1)]));
    expect(decided(recordingCall(answered), started, callStarted)).toStrictEqual(Result.succeed([answered]));
    expect(decided(recordingCall(called), started, callStarted, callAnswered)).toStrictEqual(
      Result.succeed([startOfCall(2)]),
    );
    expect(runDecider.context(recordingCall(called), stateAfter(started))).toStrictEqual({ ...during, ...ofGreet });
  });

  it('takes the number a call names only when it is the next, so a call repeated under its number is refused', () => {
    expect(decided(recordingCall({ ...called, data: { ...sent, number: 2 } }), started, callStarted)).toStrictEqual(
      Result.succeed([startOfCall(2)]),
    );
    expect(decided(recordingCall({ ...called, data: { ...sent, number: 1 } }), started, callStarted)).toEqual(
      Result.fail(
        new Conflict({
          detail:
            'The run records its calls in order, and call 1 is not its next call, 2; another attempt recorded it first',
          kind: 'taken',
        }),
      ),
    );
  });

  it('is refused once the run has ended, however it ended, and before it started', () => {
    expect(decided(recordingCall(answered), started, callStarted, failed)).toEqual(Result.fail(noMoreWork));
    expect(decided(recordingCall(called), started, succeeded)).toEqual(Result.fail(noMoreWork));
    expect(decided(recordingCall(called), started, unavailable)).toEqual(Result.fail(noMoreWork));
    expect(decided(recordingCall(called))).toEqual(Result.fail(noMoreWork));
  });

  it('is taken as the work of a run that finishes later, until it is settled', () => {
    expect(decided(recordingCall(called), started, deferred)).toStrictEqual(Result.succeed([startOfCall(1)]));
    expect(decided(recordingCall(called), started, deferred, failed)).toEqual(Result.fail(noMoreWork));
  });
});

describe('the calls a run recorded', () => {
  it('leave the run started, keeping the number of its last call and that it may have changed something', () => {
    const running = stateAfter(started, callStarted, callAnswered, meanwhile(startOfCall(2)));

    expect(running).toMatchObject({ run: { status: 'started' }, lastCall: 2, mayHaveChanged: true });
    expect(stateAfter(started, callStarted, failed)).toMatchObject({
      run: { status: 'failed' },
      lastCall: 1,
      mayHaveChanged: true,
    });
  });

  it('keep the run from running again under its id unless it succeeded or its input was rejected', () => {
    expect(decided(starting(), started, callStarted)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, failed)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, unavailable)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting(), started, callStarted, rejectedInput)).toStrictEqual(Result.succeed([]));
  });

  it('name no last call for a run that never started', () => {
    expect(lastCallOf(startedRunOf(stateAfter()))).toBe(0);
  });

  it('are counted across a start that was recorded again, so numbers never repeat under one id', () => {
    expect(stateAfter(started, callStarted, started)).toMatchObject({ lastCall: 1, mayHaveChanged: true });
    expect(decided(recordingCall(called), started, callStarted, failed, started)).toStrictEqual(
      Result.succeed([startOfCall(2)]),
    );
  });
});

describe('the calls of a run whose every tool only reads', () => {
  it('keep the run from running again under its id, saying that nothing was changed once it ended', () => {
    const readAgain = meanwhile(startOfCall(2, true));

    expect([
      decided(starting(), started, readCalled, readAgain, unavailable),
      decided(starting(), started, readCalled, failed),
      decided(starting(), started, readCalled, callStarted, unavailable),
      decided(starting(), started, readCalled),
    ]).toEqual([
      Result.fail(toolsOnlyRead),
      Result.fail(toolsOnlyRead),
      Result.fail(toolsWereCalled),
      Result.fail(toolsWereCalled),
    ]);
  });

  it('are known after a start recorded again, since each start keeps what the calls before it recorded', () => {
    expect(stateAfter(started, readCalled, failed, started)).toMatchObject({ calledOnlyReadOnly: true });
    expect(stateAfter(started, callStarted, failed, started)).toMatchObject({ calledOnlyReadOnly: false });
  });
});

const modelCallStarted = (number: number): ModelCallFact => ({
  type: 'model_call_started',
  data: { number, ...modelCallSent() },
});

const modelCallEnded: ModelCallFact = { type: 'model_call_answered', data: { number: 1, ...modelCallAnswered() } };

const modelCallFailed: ModelCallFact = { type: 'model_call_failed', data: { number: 1, ...modelCallTimedOut } };

function notTheNextModelCall(number: number, next: number): Conflict {
  return new Conflict({
    detail: `The run records its model calls in order, and model call ${number} is not its next model call, ${next}; another attempt recorded it first`,
    kind: 'taken',
  });
}

describe('a model call of a run', () => {
  it('is recorded while the run runs under the number it names when that is the next, with its answer or its failure', () => {
    const callMade = meanwhile(modelCallStarted(1));

    expect(decided(recordingCall(modelCallStarted(1)), started)).toStrictEqual(Result.succeed([modelCallStarted(1)]));
    expect(decided(recordingCall(modelCallEnded), started, callMade)).toStrictEqual(Result.succeed([modelCallEnded]));
    expect(decided(recordingCall(modelCallFailed), started, callMade)).toStrictEqual(Result.succeed([modelCallFailed]));
    expect(decided(recordingCall(modelCallStarted(2)), started, callMade, meanwhile(modelCallEnded))).toStrictEqual(
      Result.succeed([modelCallStarted(2)]),
    );
  });

  it('is refused under a number that is not the next, which another attempt took first, and once the run ended', () => {
    const callMade = meanwhile(modelCallStarted(1));

    expect(decided(recordingCall(modelCallStarted(1)), started, callMade)).toEqual(
      Result.fail(notTheNextModelCall(1, 2)),
    );
    expect(decided(recordingCall(modelCallStarted(3)), started)).toEqual(Result.fail(notTheNextModelCall(3, 1)));
    expect(decided(recordingCall(modelCallEnded), started, callMade, failed)).toEqual(Result.fail(noMoreWork));
  });

  it('is counted apart from the tool calls, across a start recorded again, and changes nothing outside', () => {
    const running = stateAfter(started, meanwhile(modelCallStarted(1)), callStarted, meanwhile(modelCallStarted(2)));

    expect(running).toMatchObject({ lastModelCall: 2, lastCall: 1 });
    expect(stateAfter(started, meanwhile(modelCallStarted(1)), failed, started)).toMatchObject({
      lastModelCall: 1,
      mayHaveChanged: false,
    });
  });
});
