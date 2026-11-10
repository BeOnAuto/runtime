import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { comparedWithoutItsValue, type ValuesRead } from '../payloads/payload-comparisons.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { keptArmOf } from '../testing/kept-payloads.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { RunCommand, RunResult } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import { endedWithAnotherResult } from './run-decisions.ts';
import type { RunEvent } from './run-events.ts';

const at = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const recorded = recordedWith({ ...at, definitionType: 'echo', definitionName: 'score', definitionVersion: 1 });

const scores = Array.from({ length: 80 }, (_, index) => `lead-${index}`);

const keptOutput = keptArmOf({ scores });

const answer = { approved: true, notes: 'n'.repeat(3000) };

const keptAnswer = keptArmOf(answer);

const started: RunEvent = { type: 'run_started', data: { input: {}, started_by: recordedAdmin, finishes_later: true } };

const succeededKept: RunEvent = {
  type: 'run_succeeded',
  data: { output_sha256: keptOutput.sha256, output_bytes: keptOutput.bytes, record: { model: 'x' } },
};

const deferred: RunEvent = { type: 'run_deferred', data: { record: { to: 'ada' } } };

const answeredKept: RunEvent = {
  type: 'request_answered',
  data: { answer_sha256: keptAnswer.sha256, answer_bytes: keptAnswer.bytes, answered_by: recordedAdmin },
};

function stateAfter(...events: readonly RunEvent[]) {
  return runStateAfter(events.map((event) => recorded(event)));
}

function settling(result: RunResult): RunCommand {
  return { type: 'settle', result, ...at };
}

function succeededWith(output: Schema.Json): RunResult {
  return { type: 'run_succeeded', data: { output, record: {} } };
}

function answering(given: Schema.Json): RunCommand {
  return { type: 'answer', answer: { answer: given, answered_by: recordedAdmin }, ...at };
}

function settlingWith(result: RunResult, valuesRead: ValuesRead): RunCommand {
  return { type: 'settle', result, valuesRead, ...at };
}

function answeringWith(given: Schema.Json, valuesRead: ValuesRead): RunCommand {
  return { type: 'answer', answer: { answer: given, answered_by: recordedAdmin }, valuesRead, ...at };
}

describe('a run that ended with an output its playbook keeps outside the run', () => {
  it('records nothing for a settlement again with the same text, answers unavailable for other text, and is a conflict for another ending', () => {
    const ended = stateAfter(started, succeededKept);

    expect([
      runDecider.decide(settling(succeededWith({ scores })), ended),
      runDecider.decide(settling(succeededWith({ scores: scores.toReversed() })), ended),
      runDecider.decide(settling({ type: 'run_failed', data: {} }), ended),
    ]).toEqual([Result.succeed([]), Result.fail(comparedWithoutItsValue), Result.fail(endedWithAnotherResult)]);
  });
});

describe('a run that took an answer its playbook keeps outside the run', () => {
  it('holds the answer by its digest and size, records nothing for it again with the same text, and answers unavailable for other text', () => {
    const answered = stateAfter(started, deferred, answeredKept);

    expect([
      runDecider.decide(answering(answer), answered),
      runDecider.decide(answering({ notes: answer.notes, approved: true }), answered),
    ]).toEqual([Result.succeed([]), Result.fail(comparedWithoutItsValue)]);
  });
});

describe('a repeated ending or answer, given the values its operation read of what the run keeps outside', () => {
  const ended = stateAfter(started, succeededKept);
  const answered = stateAfter(started, deferred, answeredKept);
  const outputRead = new Map([[keptOutput.sha256, { scores }]]);
  const answerRead = new Map([[keptAnswer.sha256, answer]]);

  it('records nothing for the same value in another order, and refuses another value', () => {
    const tookAnother: unknown = expect.stringContaining('already took another answer');

    expect([
      runDecider.decide(settlingWith(succeededWith({ scores }), outputRead), ended),
      runDecider.decide(settlingWith(succeededWith({ scores: [] }), outputRead), ended),
      runDecider.decide(answeringWith({ notes: answer.notes, approved: true }, answerRead), answered),
      runDecider.decide(answeringWith({ ...answer, approved: false }, answerRead), answered),
    ]).toMatchObject([
      Result.succeed([]),
      Result.fail(endedWithAnotherResult),
      Result.succeed([]),
      { failure: { _tag: 'conflict', detail: tookAnother } },
    ]);
  });

  it('answers unavailable where the run moved on to a value its operation did not read', () => {
    const readBefore = new Map([[keptArmOf({ scores: [] }).sha256, { scores: [] }]]);

    expect(runDecider.decide(settlingWith(succeededWith({ scores: scores.toReversed() }), readBefore), ended)).toEqual(
      Result.fail(comparedWithoutItsValue),
    );
  });
});
