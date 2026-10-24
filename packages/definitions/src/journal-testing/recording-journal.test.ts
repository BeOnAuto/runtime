import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunAttempt } from '../capability/run-context.ts';
import { toolEnded } from '../journal/run-journal.ts';
import type { ModelCallFact } from '../runs/run-commands.ts';
import { answerOfCall, failureOfCall, startOfCall } from '../testing/capabilities/tool-user.ts';
import { recordedOnTheRun } from '../testing/run-facts.ts';
import { modelCallAnswered, modelCallSent, modelCallTimedOut } from './model-calls.ts';
import { cancelledAfter, cancelledByAnother, recordingJournal } from './recording-journal.ts';

describe('a journal that records in memory, for tests', () => {
  it('keeps what it records, numbering the calls it starts, and refuses what it is told to', async () => {
    const plain = recordingJournal();
    const journal = recordingJournal(({ type }) => type !== 'tool_call_started');
    const refusingStarts = recordingJournal(({ type }) => type === 'tool_call_started');

    expect(await Effect.runPromise(journal.started(startOfCall(1)))).toBe(1);
    expect(await Effect.runPromise(journal.started(startOfCall(2)))).toBe(2);
    expect(await Effect.runPromise(journal.ended(1, answerOfCall(1)))).toBe(false);
    expect(journal.recorded()).toEqual([
      { number: 1, type: 'tool_call_started', data: startOfCall(1) },
      { number: 2, type: 'tool_call_started', data: startOfCall(2) },
    ]);
    expect(await Effect.runPromise(refusingStarts.started(startOfCall(1)))).toBeUndefined();
    expect(await Effect.runPromise(plain.started(startOfCall(1)))).toBe(1);
  });
});

describe('the ends of calls a journal records in memory, for tests', () => {
  it('keeps each open call that ends beside its number, however it ends, and refuses the end of one not open', async () => {
    const journal = recordingJournal(() => false, {
      startedAt: '2026-10-01T09:00:00.000Z',
      modelCallsBefore: 0,
      calls: [
        recordedOnTheRun({ type: 'model_call_started', data: { number: 1, ...modelCallSent() } }),
        recordedOnTheRun({ type: 'tool_call_started', data: { number: 1, ...startOfCall(1) } }),
        recordedOnTheRun({ type: 'tool_call_started', data: { number: 2, ...startOfCall(2) } }),
      ],
    });

    await Effect.runPromise(
      Effect.all([
        journal.ended(1, answerOfCall(1)),
        journal.ended(2, failureOfCall(2)),
        journal.record({ type: 'model_call_failed', data: { number: 1, ...modelCallTimedOut } }),
      ]),
    );
    expect(await Effect.runPromise(journal.ended(2, answerOfCall(2)))).toBe(false);

    expect(journal.calls().map(({ type, data }) => [type, data.number])).toEqual([
      ['tool_call_answered', 1],
      ['tool_call_failed', 2],
      ['model_call_failed', 1],
    ]);
    expect(journal.recorded()).toEqual([
      { number: 1, ...answerOfCall(1) },
      { number: 2, ...failureOfCall(2) },
      { number: 1, type: 'model_call_failed', data: modelCallTimedOut },
    ]);
  });
});

describe('the model calls a journal records in memory, for tests', () => {
  it('keeps the model calls it records under the numbers they name, the next alone, and refuses what it is told to', async () => {
    const before: RunAttempt = {
      startedAt: '2026-10-01T09:00:00.000Z',
      modelCallsBefore: 0,
      calls: [recordedOnTheRun({ type: 'model_call_started', data: { number: 1, ...modelCallSent() } })],
    };
    const journal = recordingJournal(() => false, before);
    const started: ModelCallFact = { type: 'model_call_started', data: { number: 2, ...modelCallSent() } };
    const answered: ModelCallFact = { type: 'model_call_answered', data: { number: 2, ...modelCallAnswered(0) } };
    const taken = Exit.fail(expect.objectContaining({ kind: 'taken' }));
    const later: ModelCallFact = { type: 'model_call_started', data: { number: 4, ...modelCallSent() } };
    const refusing = recordingJournal(({ type }) => type === 'model_call_started');

    expect([
      await Effect.runPromiseExit(journal.record(started)),
      await Effect.runPromiseExit(journal.record(started)),
      await Effect.runPromiseExit(journal.record(later)),
      await Effect.runPromiseExit(journal.record(answered)),
      await Effect.runPromiseExit(refusing.record(started)),
    ]).toEqual([Exit.succeed(2), taken, taken, Exit.succeed(2), taken]);
    expect(journal.attempt).toBe(before);
    expect(journal.recorded()).toEqual([
      { number: 2, type: 'model_call_started', data: modelCallSent() },
      { number: 2, type: 'model_call_answered', data: modelCallAnswered(0) },
    ]);
  });
});

describe('a journal that records in memory, whose run another server cancelled once it recorded a fact', () => {
  it('refuses every later start as cancelled, and still takes the end of the call it started', async () => {
    const journal = cancelledAfter(recordingJournal(), 1);

    expect(await Effect.runPromise(journal.started(startOfCall(1)))).toBe(1);
    expect(await Effect.runPromiseExit(journal.record({ type: 'tool_call_started', data: startOfCall(2) }))).toEqual(
      Exit.fail(cancelledByAnother),
    );
    expect(await Effect.runPromise(journal.record(toolEnded(1, answerOfCall(1))))).toBe(1);
  });
});
