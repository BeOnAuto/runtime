import type { Context } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import { runTaken, stillRunning } from './run-decisions.ts';
import type { RecordedRunEvent, RunEvent } from './run-events.ts';

const acted = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const atTheStart: Context = { ...acted, definitionType: 'resumer', definitionName: 'step', definitionVersion: 1 };

const recorded = recordedWith(atTheStart);

const resumable: RunEvent = { type: 'run_started', data: { started_by: recordedAdmin, input: {}, resumes: true } };

function resumingAs(attempt: number): RunCommand {
  return { type: 'resume', attempt, ...acted };
}

function decided(command: RunCommand, ...history: readonly RunEvent[]) {
  return runDecider.decide(command, runStateAfter(history.map((event): RecordedRunEvent => recorded(event))));
}

function finishedBy(attempt: number): RunCommand {
  return { type: 'finish', result: { type: 'run_succeeded', data: { output: null, record: {} } }, attempt, ...acted };
}

describe('the resume of a run by an attempt after the one that died', () => {
  it('records that the next attempt resumed it, numbered after the attempts before', () => {
    expect([
      decided(resumingAs(2), resumable),
      decided(resumingAs(3), resumable, { type: 'attempt_resumed', data: { attempt: 2 } }),
    ]).toStrictEqual([
      Result.succeed([{ type: 'attempt_resumed', data: { attempt: 2 } }]),
      Result.succeed([{ type: 'attempt_resumed', data: { attempt: 3 } }]),
    ]);
  });

  it('is refused as still running for a run that never started, ended, does not resume or another attempt resumed', () => {
    expect([
      decided(resumingAs(2)),
      decided(resumingAs(2), resumable, { type: 'run_succeeded', data: { output: null, record: {} } }),
      decided(resumingAs(2), { type: 'run_started', data: { started_by: recordedAdmin, input: {} } }),
      decided(resumingAs(2), resumable, { type: 'attempt_resumed', data: { attempt: 2 } }),
    ]).toStrictEqual([
      Result.fail(stillRunning),
      Result.fail(stillRunning),
      Result.fail(stillRunning),
      Result.fail(stillRunning),
    ]);
  });
});

describe('the ending of an attempt that names its number', () => {
  it('is recorded while that attempt holds the run, and refused as taken once a later one resumed it', () => {
    const resumed: RunEvent = { type: 'attempt_resumed', data: { attempt: 2 } };

    expect([decided(finishedBy(2), resumable, resumed), decided(finishedBy(1), resumable, resumed)]).toStrictEqual([
      Result.succeed([{ type: 'run_succeeded', data: { output: null, record: {} } }]),
      Result.fail(runTaken),
    ]);
  });
});
