import { Conflict, type Context } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand, RunOutcome, RunResult } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import { runTaken } from './run-decisions.ts';
import type { RecordedRunEvent, RunEvent } from './run-events.ts';
import { fencingTokenOf, startedRunOf } from './run-state.ts';

const start = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const finish = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const ofGreet = { definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };

const greeting = { definition_type: 'echo', name: 'greet', input: { who: 'Ada' } };

const started: RunEvent = { type: 'run_started', data: { started_by: recordedAdmin, input: greeting.input } };

const callingTools: RunEvent = { type: 'run_started', data: { ...started.data, calls_tools: true } };

const resuming: RunEvent = { type: 'run_started', data: { ...callingTools.data, resumes: true } };

const succeeded: RunResult = { type: 'run_succeeded', data: { output: 'Hello Ada', record: {} } };

const unavailable: RunResult = { type: 'run_rejected', data: { rejection: { reason: 'unavailable', detail: 'Busy' } } };

const failed: RunResult = { type: 'run_failed', data: {} };

const atTheStart: Context = { ...start, ...ofGreet };

const atTheFinish: Context = { ...finish, ...ofGreet };

const startedAt = recordedWith(atTheStart);

const finishedAt = recordedWith(atTheFinish);

const sent = { server: 'slack', tool: 'post_message', arguments_bytes: 2 };

const callStarted: RunEvent = { type: 'tool_call_started', data: { number: 1, call_id: 'toolu_1', ...sent } };

function decided(command: RunCommand, ...history: readonly RecordedRunEvent[]) {
  return runDecider.decide(command, runStateAfter(history));
}

function finishedBy(fencingToken: number, result: RunOutcome, version = 1): RunCommand {
  return { type: 'finish', result, attempt: { fencingToken, version }, ...finish };
}

function diedHolding(fencingToken: number): RunCommand {
  return { type: 'attempt_died', fencingToken, ...finish };
}

function callStartedBy(fencingToken: number): RunCommand {
  return {
    type: 'call',
    fact: { type: 'tool_call_started', data: { call_id: 'toolu_2', ...sent } },
    fencingToken,
    ...finish,
  };
}

const asked = { ...greeting, started_by: recordedAdmin, definition_version: 1, calls_tools: true, ...start };

const startingAgain: RunCommand = { type: 'start', ...asked };

describe('the fencing token of an attempt', () => {
  it('is one more for each start and each resume of the run, and none before it starts', () => {
    const resumed = startedAt({ type: 'attempt_resumed', data: { attempt: 2 } });

    expect([
      fencingTokenOf(startedRunOf(runStateAfter([]))),
      fencingTokenOf(startedRunOf(runStateAfter([startedAt(started)]))),
      fencingTokenOf(startedRunOf(runStateAfter([startedAt(resuming), resumed]))),
      fencingTokenOf(startedRunOf(runStateAfter([startedAt(started), finishedAt(failed), startedAt(started)]))),
    ]).toEqual([0, 1, 2, 2]);
  });
});

describe('the finish of an attempt that holds the run, once its run has ended without a final result', () => {
  it('records no second ending, so a late holder adds nothing to how the run ended', () => {
    expect([
      decided(finishedBy(1, unavailable), startedAt(started), finishedAt(failed)),
      decided(finishedBy(1, failed), startedAt(started), finishedAt(unavailable)),
    ]).toStrictEqual([Result.succeed([]), Result.succeed([])]);
  });

  it('records no result either, since the ending recorded in its place stands for whoever acted on it', () => {
    expect([
      decided(finishedBy(1, succeeded), startedAt(started), finishedAt(failed)),
      decided(finishedBy(1, succeeded), startedAt(callingTools), startedAt(callStarted), finishedAt(unavailable)),
    ]).toStrictEqual([Result.succeed([]), Result.succeed([])]);
  });

  it('records its result while its run is still going, so a result is recorded whenever the run has none', () => {
    expect([
      decided(finishedBy(1, succeeded), startedAt(started)),
      decided(finishedBy(1, succeeded), startedAt(callingTools), startedAt(callStarted)),
    ]).toStrictEqual([Result.succeed([succeeded]), Result.succeed([succeeded])]);
  });

  it('leaves a stream an earlier release wrote with a late ending after another folded as it was, by its last ending', () => {
    expect(runStateAfter([startedAt(started), finishedAt(failed), finishedAt(succeeded)])).toMatchObject({
      run: { status: 'succeeded' },
      result: succeeded,
    });
  });
});

describe('the finish of an attempt whose run a later start holds', () => {
  const twoStarts = [startedAt(started), startedAt(started)] as const;

  it('is refused as taken without a result, so it never ends the attempt that holds the run', () => {
    expect([
      decided(finishedBy(1, unavailable), ...twoStarts),
      decided(finishedBy(1, failed), ...twoStarts, finishedAt(failed)),
    ]).toStrictEqual([Result.fail(runTaken), Result.fail(runTaken)]);
  });

  it('records its result while the run has none, the later attempt has started no call and both run one version', () => {
    expect([
      decided(finishedBy(1, succeeded), ...twoStarts),
      decided(finishedBy(1, succeeded), ...twoStarts, finishedAt(unavailable)),
      decided(finishedBy(1, succeeded), ...twoStarts, startedAt(callStarted)),
      decided(finishedBy(1, succeeded, 2), ...twoStarts),
    ]).toStrictEqual([
      Result.succeed([succeeded]),
      Result.succeed([succeeded]),
      Result.fail(runTaken),
      Result.fail(runTaken),
    ]);
  });
});

describe('the start of a call by an attempt', () => {
  it('is refused as taken where a later attempt holds the run, so an attempt it lost sends nothing', () => {
    expect([
      decided(callStartedBy(1), startedAt(callingTools), finishedAt(failed), startedAt(callingTools)),
      decided(callStartedBy(2), startedAt(callingTools), finishedAt(failed), startedAt(callingTools)),
    ]).toStrictEqual([
      Result.fail(runTaken),
      Result.succeed([{ type: 'tool_call_started', data: { call_id: 'toolu_2', ...sent, number: 1 } }]),
    ]);
  });
});

describe('a start again of a run within its call whose attempt was ended as dead before any call', () => {
  it('is a new attempt with the next token, since the attempt ended in its place can no longer start a call', () => {
    expect([
      decided(startingAgain, startedAt(callingTools), finishedAt(failed)),
      fencingTokenOf(
        startedRunOf(runStateAfter([startedAt(callingTools), finishedAt(failed), startedAt(callingTools)])),
      ),
    ]).toStrictEqual([Result.succeed([{ type: 'run_started', data: { ...started.data, calls_tools: true } }]), 2]);
  });
});

describe('the ending of a run whose attempt died', () => {
  it('is refused for a run that never started or has ended, for an attempt that no longer holds it, and for one that outlives its call', () => {
    const endedAlready = new Conflict({
      detail: 'The run has ended, so it records no more of its work',
      kind: 'taken',
    });
    const outlivesItsCall = new Conflict({
      detail:
        'The run outlives the call that started it, so an attempt of it that died is resumed or settled, never ended in its place',
    });

    expect([
      decided(diedHolding(1)),
      decided(diedHolding(1), startedAt(started), finishedAt(failed)),
      decided(diedHolding(1), startedAt(started), finishedAt(failed), startedAt(started)),
      decided(diedHolding(1), startedAt(resuming)),
    ]).toStrictEqual([
      Result.fail(endedAlready),
      Result.fail(endedAlready),
      Result.fail(runTaken),
      Result.fail(outlivesItsCall),
    ]);
  });

  it('breaks a run within its call down where it made no call', () => {
    expect(decided(diedHolding(1), startedAt(started))).toStrictEqual(Result.succeed([failed]));
  });

  it('ends a run whose caller asked to cancel it as cancelled, with the kind and the reason its caller gave', () => {
    const deadline: RunEvent = { type: 'run_cancel_requested', data: { kind: 'deadline', reason: 'Out of time' } };

    expect(decided(diedHolding(1), startedAt(started), startedAt(deadline))).toStrictEqual(
      Result.succeed([
        { type: 'run_rejected', data: { rejection: { reason: 'cancelled', kind: 'deadline', detail: 'Out of time' } } },
      ]),
    );
  });
});

describe('the ending of a run that resumes, whose attempt died, where its shell makes no next attempt of it', () => {
  const withNoNextAttempt: RunCommand = { type: 'attempt_died', fencingToken: 1, noNextAttempt: true, ...finish };

  it('ends it as a run within its call is ended, by what it called', () => {
    const interrupted: RunEvent = {
      type: 'tool_call_failed',
      data: { number: 1, because: 'interrupted', duration_ms: 0, jsonrpc_id: null },
    };
    const notKnown =
      'Its attempt ended while it called a tool that may change something, so whether that call did is not known';

    expect([
      decided(withNoNextAttempt, startedAt(resuming)),
      decided(withNoNextAttempt, startedAt(resuming), startedAt(callStarted)),
    ]).toStrictEqual([
      Result.succeed([failed]),
      Result.succeed([
        interrupted,
        {
          type: 'run_rejected',
          data: {
            rejection: {
              reason: 'conflict',
              kind: 'effect_unknown',
              because: 'call_outcome_unknown',
              detail: notKnown,
            },
          },
        },
      ]),
    ]);
  });

  it('still leaves a run that finishes later to its settlement', () => {
    const finishingLater: RunEvent = { type: 'run_started', data: { ...started.data, finishes_later: true } };

    const outlivesItsCall = new Conflict({
      detail:
        'The run outlives the call that started it, so an attempt of it that died is resumed or settled, never ended in its place',
    });

    expect(decided(withNoNextAttempt, startedAt(finishingLater))).toStrictEqual(Result.fail(outlivesItsCall));
  });
});
