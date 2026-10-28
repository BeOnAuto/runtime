import { PublicEventSchema, mostPublicEventDataBytes, presentationOf, type RecordedEvent } from '@on.auto/operations';
import { internalTermsIn } from '@on.auto/operations/testing';
import { nothingKept } from '@on.auto/operations/testing';
import {
  RunLogEventSchema,
  callKeyText,
  mostEventBytes,
  type InputReceipt,
  type RunLogEvent,
  type RunOutput,
} from '@on.auto/workflow-engine';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { testPlaybookNames } from '../testing/test-sandbox.ts';
import { cutAtCodePoint } from './cut-text.ts';
import { runPresenter } from './run-presenter.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runKey = `acme/alpha/${runId}`;

const at = Date.parse('2026-10-05T09:00:00.000Z');

const encodeEvent = Schema.encodeSync(Schema.toCodecJson(RunLogEventSchema));

const decodePublicEvent = Schema.decodeUnknownResult(PublicEventSchema);

const presentation = presentationOf([runPresenter]);

const showing = { streamPrefix: 'playbook/acme/alpha/', content: nothingKept, view: 'page' } as const;

function present(record: RecordedEvent) {
  return presentation.present(record, showing).at(0);
}

const utf8 = new TextEncoder();

function stepsOf(count: number, reference = '/do/0/notify'): RunLogEvent['steps'] {
  return Array.from({ length: count }, (_, index) => ({ reference, run: index + 1, outcome: 'completed' }));
}

function eventOf(
  receipt: InputReceipt,
  steps: RunLogEvent['steps'] = [],
  outputs: readonly RunOutput[] = [],
  patch: RunLogEvent['patch'] = [],
): RunLogEvent {
  return { type: 'input_applied', format: 3, receipt, steps, patch, outputs };
}

function recordOf(event: RunLogEvent): RecordedEvent {
  return {
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
}

const ofTheRun: unknown = expect.objectContaining({
  causation_id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a',
  at: '2026-10-05T09:00:00.000Z',
  run_id: runId,
  definition: { type: 'workflow', name: 'triage', version: 1 },
});

const settled: RunOutput = { kind: 'settle', runId: runKey, settlement: { status: 'succeeded', output: 1 } };

const armed: RunOutput = { kind: 'arm_timer', runId: runKey, timerId: '2', dueAt: at + 60_000, purpose: 'wait' };

const callKey = { runId: runKey, reference: '/do/0/notify', run: 1 };

describe('an input a workflow took, in the history of its run', () => {
  it('is one public event with the kind and key of the input, its steps, and the kinds of output it made', () => {
    const event = eventOf({ kind: 'started', key: runKey, at }, stepsOf(1), [armed, armed]);

    expect(present(recordOf(event))).toEqual({
      id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
      type: 'workflow_input_applied',
      summary: 'The workflow started, and 1 step moved.',
      metadata: ofTheRun,
      data: {
        input: { kind: 'started', key: runId },
        step_count: 1,
        steps: [{ task: '/do/0/notify', run: 1, outcome: 'completed' }],
        output_kinds: ['arm_timer'],
      },
    });
  });

  it('shows the count of the steps it moved and the first five', () => {
    const event = eventOf({ kind: 'timer_fired', key: '2', at }, stepsOf(7));

    expect(present(recordOf(event))?.data).toMatchObject({
      input: { kind: 'timer_fired', key: '2' },
      step_count: 7,
      steps: stepsOf(5).map(({ reference, run, outcome }) => ({ task: reference, run, outcome })),
    });
  });
});

describe('the words of an input a workflow took', () => {
  it.each([
    [eventOf({ kind: 'started', key: runKey, at }), 'The workflow started.'],
    [
      eventOf({ kind: 'timer_fired', key: '2', at }, stepsOf(2)),
      'A timer of the workflow went off, and 2 steps moved.',
    ],
    [
      eventOf({ kind: 'call_answered', key: callKeyText(callKey), at, status: 'succeeded' }, [], [settled]),
      'A function the workflow called answered; the workflow ended.',
    ],
    [
      eventOf({ kind: 'call_answered', key: callKeyText(callKey), at, status: 'unreachable' }),
      'A function the workflow called did not succeed.',
    ],
    [
      eventOf({ kind: 'event_received', key: 'e-1', at, eventType: 'com.acme.approved' }),
      'The workflow received an event.',
    ],
    [
      eventOf({ kind: 'cancel_requested', key: runKey, at }, [], [settled]),
      'The workflow was asked to stop; the workflow ended.',
    ],
  ])('says what happened in plain words: %#', (event, summary) => {
    const presented = present(recordOf(event));

    expect(presented?.summary).toBe(summary);
    expect(internalTermsIn(summary)).toEqual([]);
  });
});

function rejectedWith(kind: string, because?: string): InputReceipt {
  const rejection = because === undefined ? { kind } : { kind, because };
  return { kind: 'call_answered', key: callKeyText(callKey), at, status: 'rejected', rejection };
}

describe('the words of a rejection of a function a workflow called', () => {
  it('says why it did not succeed in plain words, after what happened', () => {
    expect(
      present(recordOf(eventOf(rejectedWith('tools_unfinished', 'server_failed'), stepsOf(1), [settled])))?.summary,
    ).toBe(
      'A function the workflow called did not succeed, and 1 step moved; the workflow ended. It called tools but could not finish, because a tool server failed.',
    );
  });

  it.each([
    [
      rejectedWith('tool_not_offered', 'tool_server_not_configured'),
      'A function the workflow called did not succeed. This server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this playbook.',
    ],
    [
      rejectedWith('tool_server_failed', 'rate_limited'),
      'A function the workflow called did not succeed. A tool server it needs could not be used, because the tool server asked it to slow down for longer than a run waits.',
    ],
    [
      rejectedWith('tools_called'),
      'A function the workflow called did not succeed. This run calls tools, and an attempt of it under the same id may still be in progress or did not succeed, so its tools may have changed something.',
    ],
    [
      rejectedWith('effect_unknown', 'server_failed'),
      'A function the workflow called did not succeed. It could not finish after calling a tool that may change something, so whether that happened is not known, because a tool server failed.',
    ],
    [
      rejectedWith('account_closed', 'org_deleted'),
      'A function the workflow called did not succeed. The account it runs under is closed, since its org was deleted.',
    ],
    [
      rejectedWith('input_schema'),
      'A function the workflow called did not succeed. What was given does not fit what it needs.',
    ],
    [rejectedWith('something_new', 'some_reason'), 'A function the workflow called did not succeed.'],
  ])('says each kind and because it knows: %#', (receipt, summary) => {
    expect(present(recordOf(eventOf(receipt)))?.summary).toBe(summary);
    expect(internalTermsIn(summary)).toEqual([]);
  });
});

describe('an answer or an event a workflow took, in the history of its run', () => {
  it('shows the status of an answer and the type of an event', () => {
    const answered = eventOf({ kind: 'call_answered', key: callKeyText(callKey), at, status: 'failed' });
    const received = eventOf({ kind: 'event_received', key: 'e-1', at, eventType: 'com.acme.approved' });

    expect([present(recordOf(answered))?.data, present(recordOf(received))?.data]).toMatchObject([
      { input: { kind: 'call_answered', key: callKeyText(callKey), status: 'failed' } },
      { input: { kind: 'event_received', key: 'e-1', event_type: 'com.acme.approved' } },
    ]);
  });
});

describe('a rejection of a function a workflow called, in the history of its run', () => {
  it('shows the kind and because of the rejection, each cut at 256 bytes', () => {
    const rejected = eventOf({
      kind: 'call_answered',
      key: callKeyText(callKey),
      at,
      status: 'rejected',
      rejection: { kind: 'tools_unfinished', because: '😀'.repeat(100) },
    });
    const unnamed = eventOf({
      kind: 'call_answered',
      key: callKeyText(callKey),
      at,
      status: 'rejected',
      rejection: {},
    });

    expect([present(recordOf(rejected))?.data, present(recordOf(unnamed))?.data]).toMatchObject([
      { input: { status: 'rejected', rejection: { kind: 'tools_unfinished', because: '😀'.repeat(64) } } },
      { input: { status: 'rejected', rejection: {} } },
    ]);
  });
});

describe('the largest input a workflow can take', () => {
  it('presents within the bound of public data', () => {
    const awkward = '\u0000'.repeat(256);
    const steps = stepsOf(100, `/do/0/${'😀'.repeat(1024)}`);
    const patch: RunLogEvent['patch'] = [{ op: 'add', path: '/machine/values/9', value: 'x'.repeat(1_150_000) }];
    const outputs: readonly RunOutput[] = [
      armed,
      { kind: 'cancel_timer', runId: runKey, timerId: '2' },
      { kind: 'start_call', key: callKey, function: 'notify', arguments: {}, longestMs: 1000 },
      { kind: 'cancel_call', key: callKey },
      settled,
    ];
    const event = eventOf({ kind: 'event_received', key: awkward, at, eventType: awkward }, steps, outputs, patch);
    const presented = present(recordOf(event));
    const bytes = utf8.encode(JSON.stringify(event)).byteLength;

    expect([bytes > mostEventBytes - 32_768, bytes <= mostEventBytes]).toEqual([true, true]);
    expect(utf8.encode(JSON.stringify(presented?.data)).byteLength).toBeLessThanOrEqual(mostPublicEventDataBytes);
    expect(Result.isSuccess(decodePublicEvent(presented))).toBe(true);
  });
});

describe('the presenter of the runs of workflows', () => {
  it('decides on every stored type of the log of a run', () => {
    expect(Object.keys(runPresenter.publicNames)).toEqual(['input_applied']);
    expect(runPresenter.publicNames['input_applied']).toEqual([
      'workflow_input_applied',
      'step_started',
      'step_waiting',
      'step_finished',
      'step_failed',
      'step_skipped',
    ]);
  });

  it('shows them under names no event from outside may take', () => {
    expect(
      Object.values(runPresenter.publicNames)
        .flat()
        .filter((name) => !testPlaybookNames.types.has(name)),
    ).toEqual([]);
  });

  it('cuts a text at a code point, counting its bytes as JSON', () => {
    expect([cutAtCodePoint('a😀b', 3), cutAtCodePoint('a😀b', 5), cutAtCodePoint('\u0000a', 6)]).toEqual([
      'a',
      'a😀',
      '\u0000',
    ]);
  });
});
