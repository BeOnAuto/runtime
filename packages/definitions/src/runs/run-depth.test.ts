import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import { runTaken } from './run-decisions.ts';
import type { RunEvent } from './run-events.ts';

const start = { runId: testRunId, by: 'playbook:alpha', at: '2026-10-01T09:00:00.000Z' };

const finish = { runId: testRunId, by: 'playbook:alpha', at: '2026-10-01T09:00:05.000Z' };

const ofGreet = { definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };

const greeting = { definition_type: 'echo', name: 'greet', input: { who: 'Ada' } };

interface StartOptions {
  readonly depth?: number;
  readonly createOnly?: true;
  readonly input?: { readonly who: string };
  readonly trigger?: { readonly kind: 'event' | 'cron' | 'every'; readonly reference: string };
}

function starting(options: StartOptions): RunCommand {
  return {
    type: 'start',
    ...greeting,
    started_by: recordedAdmin,
    calls_tools: false,
    definition_version: 1,
    ...start,
    ...options,
  };
}

const started: RunEvent = { type: 'run_started', data: { started_by: recordedAdmin, input: greeting.input } };

const startedDeep = recordedWith({ ...start, ...ofGreet, depth: 2 })(started);

const finishing: RunCommand = {
  type: 'finish',
  result: { type: 'run_succeeded', data: { output: 'Hi', record: {} } },
  ...finish,
};

const failing: RunCommand = { type: 'finish', result: { type: 'run_failed', data: {} }, ...finish };

const ended = recordedWith({ ...finish, ...ofGreet, depth: 2 });

describe('the reaction depth of a run', () => {
  it('is the context of its start when it is above 0, and of its ending, from the start', () => {
    expect([
      runDecider.context(starting({ depth: 2 }), runDecider.initialState),
      runDecider.context(starting({ depth: 0 }), runDecider.initialState),
      runDecider.context(finishing, runStateAfter([startedDeep])),
    ]).toStrictEqual([
      { ...start, ...ofGreet, depth: 2 },
      { ...start, ...ofGreet },
      { ...finish, ...ofGreet, depth: 2 },
    ]);
  });
});

describe('the trigger that started a run', () => {
  it('is the context of its start, and of every ending from the start', () => {
    const trigger = { kind: 'cron' as const, reference: '/schedule/cron' };
    const startedByCron = recordedWith({ ...start, ...ofGreet, trigger })(started);

    expect([
      runDecider.context(starting({ trigger }), runDecider.initialState),
      runDecider.context(finishing, runStateAfter([startedByCron])),
      runDecider.context(failing, runStateAfter([startedByCron])),
    ]).toStrictEqual([
      { ...start, ...ofGreet, trigger },
      { ...finish, ...ofGreet, trigger },
      { ...finish, ...ofGreet, trigger },
    ]);
  });
});

describe('a start that only creates', () => {
  it('starts a run that does not exist, and again one that ended without a result, under the same request', () => {
    const failed = ended({ type: 'run_failed', data: {} });

    expect([
      runDecider.decide(starting({ createOnly: true, depth: 2 }), runDecider.initialState),
      runDecider.decide(starting({ createOnly: true, depth: 2 }), runStateAfter([startedDeep, failed])),
    ]).toEqual([Result.succeed([started]), Result.succeed([started])]);
  });

  it('is refused as taken for a run that goes, that ended with a result, or that another request ended', () => {
    const succeeded = ended({ type: 'run_succeeded', data: { output: 'Hi', record: {} } });
    const failed = ended({ type: 'run_failed', data: {} });

    expect([
      runDecider.decide(starting({ createOnly: true }), runStateAfter([startedDeep])),
      runDecider.decide(starting({ createOnly: true }), runStateAfter([startedDeep, succeeded])),
      runDecider.decide(starting({ createOnly: true, input: { who: 'Grace' } }), runStateAfter([startedDeep, failed])),
    ]).toEqual([Result.fail(runTaken), Result.fail(runTaken), Result.fail(runTaken)]);
  });
});
