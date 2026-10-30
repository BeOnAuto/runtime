import type { RecordedEvent } from '@on.auto/operations';
import { recordingTracer } from '@on.auto/operations/testing';
import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { callConsumerOf, deliverySweeps } from './consumers.ts';
import { playbookOfKey, stepOf, type StepParts } from './record-steps.ts';
import type { GateVerdict } from './run-gate.ts';

const playbookKey = 'playbook/acme/alpha/';

const parts: StepParts = {
  consumers: [],
  definitionType: 'workflow',
  applyDefinitionRecord: () => Effect.succeed('applied'),
  unreadable: () => Effect.void,
  passedEarly: () => Effect.void,
  registered: [],
  calls: [],
};

const record: RecordedEvent = {
  id: 'record-1',
  cursor: 'cursor-1',
  causationId: null,
  correlationId: null,
  stream: `${playbookKey}run-logs/r-1`,
  version: 1,
  globalPosition: 1,
  type: 'input_applied',
  data: null,
  context: { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' },
  recordedAt: '2026-10-01T09:00:00.000Z',
};

const fresh = { cursor: null, delivered: null, attempts: 0, waiting: false };

function steppedPast(verdict: GateVerdict, wantsMore: boolean) {
  const gate = { verdictOn: () => Effect.succeed(verdict) };
  const stepping = {
    playbookKey,
    gate,
    mode: 'signal' as const,
    delivered: () => new Set<string>(),
    pageRead: Function.constVoid,
    readWithData: () => false,
    delivers: () => Effect.succeed(false),
    reactsTo: () => Effect.succeed(false),
    wantsMore: () => Effect.succeed(wantsMore),
  };
  return Effect.runPromise(stepOf(parts, stepping, fresh, record));
}

describe('the step over the record of a run that passed listeners', () => {
  it('ends a pass when its listeners want records it did not read the data of, so the next reads it', async () => {
    const passed = { cursor: 'cursor-1', delivered: null, attempts: 0, waiting: false };

    expect([await steppedPast('listened', true), await steppedPast('listened', false)]).toEqual([
      { progress: passed, end: 'more' },
      { progress: passed },
    ]);
  });
});

const answering = callConsumerOf({
  name: 'call_answers',
  types: ['call_answered'],
  skippedAfterSweeps: deliverySweeps,
  readOf: (call) => call,
  batchOf: () =>
    Effect.succeed({
      deliveries: [{ key: 'notify', workflow: 'close', deliver: Effect.void, skipped: () => Effect.void }],
      through: undefined,
      more: false,
    }),
});

const answered: RecordedEvent = {
  ...record,
  stream: `${playbookKey}calls/c-1`,
  type: 'call_answered',
  correlationId: 'run-0',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
};

function deliveredUnder(followed: RecordedEvent) {
  const recording = recordingTracer();
  const stepping = {
    playbookKey,
    gate: { verdictOn: () => Effect.succeed<GateVerdict>('passed') },
    mode: 'signal' as const,
    delivered: () => new Set(['call_answered']),
    pageRead: Function.constVoid,
    readWithData: (type: string) => type === 'call_answered',
    delivers: () => Effect.succeed(true),
    reactsTo: () => Effect.succeed(false),
    wantsMore: () => Effect.succeed(false),
  };
  return Effect.runPromise(
    Effect.withTracer(stepOf({ ...parts, calls: [answering] }, stepping, fresh, followed), recording.tracer),
  ).then(() => recording.spans());
}

describe('the step over a record a consumer wants', () => {
  it('is a span named for the type of the record, linked to the trace of the append that kept it', async () => {
    const [span] = await deliveredUnder(answered);

    expect(span).toMatchObject({
      name: 'follow call_answered',
      parentSpanId: undefined,
      attributes: {
        'auto.on.stream': `${playbookKey}calls/c-1`,
        'auto.on.position': 1,
        'auto.on.message_id': 'record-1',
        'auto.on.correlation_id': 'run-0',
      },
      links: [{ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' }],
    });
  });

  it('links to nothing when the record was kept without a trace or a chain', async () => {
    const { traceId, spanId, ...untraced } = answered;
    const [span] = await deliveredUnder({ ...untraced, correlationId: null });

    expect([traceId, spanId, span?.links]).toEqual([answered.traceId, answered.spanId, []]);
    expect(span?.attributes).toEqual({
      'auto.on.stream': `${playbookKey}calls/c-1`,
      'auto.on.position': 1,
      'auto.on.message_id': 'record-1',
    });
  });
});

describe('the key of a playbook the host follows', () => {
  it('names its org and its playbook, and is a defect of the host when it names no playbook', () => {
    expect(playbookOfKey(playbookKey)).toEqual({ org: 'acme', playbook: 'alpha' });
    expect(() => playbookOfKey('org/acme/alpha/')).toThrow(
      'The host follows org/acme/alpha/, which is not the key of a playbook',
    );
  });
});
