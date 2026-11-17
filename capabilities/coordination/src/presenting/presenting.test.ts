import { mostPublicEventDataBytes, presentationOf, PublicEventSchema, type RecordedEvent } from '@on.auto/operations';
import { internalTermsIn, nothingKept } from '@on.auto/operations/testing';
import {
  callKeyText,
  type InputReceipt,
  type RunLogEvent,
  RunLogEventSchema,
  type Step,
} from '@on.auto/workflow-engine';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runPresenter } from './run-presenter.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runKey = `acme/alpha/${runId}`;

const at = Date.parse('2026-10-05T09:00:00.000Z');

const encodeEvent = Schema.encodeSync(Schema.toCodecJson(RunLogEventSchema));

const presentation = presentationOf([runPresenter]);

const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' } as const;

function presented(receipt: InputReceipt) {
  const event: RunLogEvent = { type: 'input_applied', format: 6, receipt, steps: [], patch: [], outputs: [] };
  const record: RecordedEvent = {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a',
    correlationId: runId,
    stream: `run-logs/${runId}`,
    version: 1,
    globalPosition: 1,
    type: event.type,
    data: encodeEvent(event),
    context: {
      at: '2026-10-05T09:00:00.000Z',
      by: 'acme-admin',
      runId,
      definitionType: 'workflow',
      definitionName: 'triage',
      definitionVersion: 1,
    },
    recordedAt: '2026-10-05T09:00:00.000Z',
  };
  return presentation.present(record, showing).at(0);
}

const callKey = callKeyText({ runId: runKey, reference: '/do/0/review', run: 1 });

describe('a cancel a workflow took, in the history of its run', () => {
  it('names who cancelled it and why, in plain words and in its data', () => {
    const cancelled = presented({
      kind: 'cancel_requested',
      key: runKey,
      at,
      cancel: { by: 'acme-admin', kind: 'requested' },
    });

    expect(cancelled?.summary).toBe(
      'acme-admin cancelled the workflow. It was cancelled at the request of someone allowed to change the playbook.',
    );
    expect(cancelled?.data).toMatchObject({
      input: { kind: 'cancel_requested', key: runId, cancel: { by: 'acme-admin', kind: 'requested' } },
    });
    expect(internalTermsIn(String(cancelled?.summary))).toEqual([]);
  });
});

describe('the answer of a run a workflow waited for that was cancelled', () => {
  it.each([
    ['deadline', 'The step that waited for it ran out of time, so it was cancelled.'],
    ['parent_ended', 'The run that waited for it ended first, so it was cancelled.'],
  ])('says why the run was cancelled, for the kind %s', (kind, why) => {
    const answered = presented({ kind: 'call_answered', key: callKey, at, status: 'rejected', rejection: { kind } });

    expect(answered?.summary).toBe(`A function the workflow called did not succeed. ${why}`);
  });
});

describe('the answer of a request a workflow waited for that nobody answered', () => {
  it.each([
    ['expired', 'Nobody answered what it asked before the request expired.'],
    ['undelivered', 'What it had to send could not be delivered, though every attempt was made.'],
  ])('says why the request ended unanswered, for the kind %s', (kind, why) => {
    const answered = presented({ kind: 'call_answered', key: callKey, at, status: 'rejected', rejection: { kind } });

    expect(answered?.summary).toBe(`A function the workflow called did not succeed. ${why}`);
  });
});

const decodePublicEvent = Schema.decodeUnknownResult(PublicEventSchema);

function present(record: RecordedEvent) {
  return presentation.present(record, showing);
}

const utf8 = new TextEncoder();

const cursor = 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ';

const recordId = '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3';

function recordOf(steps: readonly Step[]): RecordedEvent {
  const event: RunLogEvent = {
    type: 'input_applied',
    format: 4,
    receipt: { kind: 'call_answered', key: 'k', at, status: 'succeeded' },
    steps,
    resumed: null,
    patch: [],
    outputs: [],
  };
  return {
    id: recordId,
    cursor,
    causationId: null,
    correlationId: runId,
    stream: `run-logs/${runId}`,
    version: 1,
    globalPosition: 1,
    type: event.type,
    data: encodeEvent(event),
    context: {
      at: '2026-10-05T09:00:00.000Z',
      by: 'acme-admin',
      runId,
      definitionType: 'workflow',
      definitionName: 'triage',
      definitionVersion: 1,
    },
    recordedAt: '2026-10-05T09:00:00.000Z',
  };
}

const ask = { reference: '/do/0/ask', run: 1, name: 'ask', times: 1 };

const completed: Step = { ...ask, outcome: 'completed', caused_by: 'input' };

const next = { reference: '/do/1/next', run: 1, name: 'next', times: 1 };

const waiting: Step = {
  ...next,
  outcome: 'waiting',
  waits_for: 'call',
  child: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a',
  caused_by: { reference: '/do/0/ask', run: 1, outcome: 'completed', times: 1 },
};

const asked: readonly Step[] = [completed, waiting];

const causedByTheInput: unknown = expect.objectContaining({
  causation_id: recordId,
  at: '2026-10-05T09:00:00.000Z',
  run_id: runId,
});

const causedByTheFirstStep: unknown = expect.objectContaining({ causation_id: `${recordId}_1` });

const presentedSteps = [
  {
    id: `${recordId}_1`,
    type: 'step_finished',
    summary: 'The step “ask” finished.',
    data: { name: 'ask', reference: '/do/0/ask', run: 1, times: 1 },
    metadata: causedByTheInput,
  },
  {
    id: `${recordId}_2`,
    type: 'step_waiting',
    summary: 'The step “next” waits for a function it called.',
    data: {
      name: 'next',
      reference: '/do/1/next',
      run: 1,
      times: 1,
      waits_for: 'call',
      run_id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a',
    },
    metadata: causedByTheFirstStep,
  },
];

describe('the steps of an input a workflow took, in the history of its run', () => {
  it('follow the input as events of their own, each its record id and its number, caused by the input or a step', () => {
    const [record, ...steps] = present(recordOf(asked));

    expect(record).toMatchObject({ id: recordId, type: 'workflow_input_applied', data: { step_count: 2 } });
    expect(steps).toEqual(presentedSteps);
  });

  it('name as the cause of a step the input itself when the step that caused it was recorded with an earlier input', () => {
    const [, resumed] = present(
      recordOf([{ ...next, outcome: 'completed', caused_by: { ...ask, outcome: 'waiting' } }]),
    );

    expect(resumed).toMatchObject({ id: `${recordId}_1`, metadata: { causation_id: recordId } });
  });
});

describe('the steps of an input a workflow took, in plain words', () => {
  it.each([
    [
      { outcome: 'raised', error: { type: 'https://example.com/busy', title: 'Busy' } },
      'step_failed',
      'The step “ask” failed.',
    ],
    [
      { outcome: 'timed_out', error: { type: 'https://example.com/timeout' } },
      'step_failed',
      'The step “ask” took too long, so it was stopped.',
    ],
    [{ outcome: 'cancelled' }, 'step_failed', 'The step “ask” was cancelled.'],
    [{ outcome: 'skipped' }, 'step_skipped', 'The step “ask” was skipped.'],
    [{ outcome: 'waiting', waits_for: 'timer' }, 'step_waiting', 'The step “ask” waits for its time.'],
    [{ outcome: 'waiting', waits_for: 'event' }, 'step_waiting', 'The step “ask” waits for an event.'],
    [{ outcome: 'waiting' }, 'step_waiting', 'The step “ask” waits for an event.'],
  ] as const)('present each outcome in plain words: %#', (moved, type, summary) => {
    const [, step] = present(recordOf([{ ...ask, caused_by: 'input', ...moved }]));

    expect([step?.type, step?.summary, internalTermsIn(summary)]).toEqual([type, summary, []]);
  });

  it('show the error of a step that failed with one, and how it failed', () => {
    const shown = [
      { outcome: 'raised', error: { type: 'https://example.com/busy', title: 'Busy' } },
      { outcome: 'timed_out', error: { type: 'https://example.com/timeout' } },
      { outcome: 'cancelled' },
    ] as const;

    expect(shown.map((moved) => present(recordOf([{ ...ask, caused_by: 'input', ...moved }]))[1]?.data)).toEqual([
      { ...dataOfAsk, outcome: 'raised', error: { type: 'https://example.com/busy', title: 'Busy' } },
      { ...dataOfAsk, outcome: 'timed_out', error: { type: 'https://example.com/timeout' } },
      { ...dataOfAsk, outcome: 'cancelled' },
    ]);
  });
});

describe('a step with an awkward name, or the largest a record holds', () => {
  it('name a step whose name holds no letter or digit as a step', () => {
    const [, step] = present(recordOf([{ ...ask, name: '--', outcome: 'started', caused_by: 'input' }]));

    expect(step?.summary).toBe('A step started.');
  });

  it('present within the bound of public data at the largest step an input records', () => {
    const largest: Step = {
      reference: `/do/0/${'😀'.repeat(1024)}`,
      run: 1,
      name: '😀'.repeat(64),
      times: 1,
      outcome: 'raised',
      caused_by: 'input',
      error: { type: '\\u0000'.repeat(1024), title: '\\u0000'.repeat(1024) },
    };
    const [, step] = present(recordOf([largest]));

    expect(utf8.encode(JSON.stringify(step?.data)).byteLength).toBeLessThanOrEqual(mostPublicEventDataBytes);
    expect(Result.isSuccess(decodePublicEvent(step))).toBe(true);
  });
});

const dataOfAsk = { name: 'ask', reference: '/do/0/ask', run: 1, times: 1 };
