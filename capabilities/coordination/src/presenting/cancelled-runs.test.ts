import { presentationOf, type RecordedEvent } from '@on.auto/operations';
import { internalTermsIn } from '@on.auto/operations/testing';
import { nothingKept } from '@on.auto/operations/testing';
import { RunLogEventSchema, callKeyText, type InputReceipt, type RunLogEvent } from '@on.auto/workflow-engine';
import { Schema } from 'effect';
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
