import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { contentHoldersOf } from '@on.auto/operations';
import { payloadBytesOf, payloadsNamed } from '@on.auto/operations/payloads';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { callKeyText, clampedAt, inputTimeOf, receiptOf, type RunInput } from '../index.ts';
import { eventBytesOf, RunLogEventSchema } from '../run-log/run-event.ts';
import { stateFormatKeepingPayloads } from '../run-log/state-format.ts';
import { testCancel } from '../testing/driver-inputs.ts';
import { armedTimer, at, openCall, runId, runningState, started } from '../testing/runs.ts';
import { RunLogRecordSchema } from './run-decider.ts';

const runIdRunDecider = '0199a3c4-7d2e-7c1a-9b3f-000000000316';

const theRunEnded = Schema.decodeUnknownSync(Schema.toCodecJson(RunLogEventSchema))({
  type: 'input_applied',
  format: 10,
  receipt: {
    kind: 'call_answered',
    key: `["${runIdRunDecider}","/do/1/second",3]`,
    at: 1_790_845_380_200,
    status: 'succeeded',
  },
  steps: [
    {
      reference: '/do/1/second',
      run: 1,
      outcome: 'completed',
      name: 'second',
      times: 1,
      caused_by: { reference: '/do/1/second', run: 1, outcome: 'waiting', times: 5 },
    },
  ],
  resumed: { reference: '/do/1/second', run: 1, times: 5 },
  patch: [
    { op: 'replace', path: '/status', value: 'ended' },
    { op: 'replace', path: '/inputs', value: 7 },
    { op: 'remove', path: '/timers/armed/1' },
    { op: 'replace', path: '/outcome', value: { kind: 'completed', output: { summary: 'tally of {}' } } },
  ],
  outputs: [
    { kind: 'cancel_timer', runId: runIdRunDecider, timerId: '1' },
    { kind: 'settle', runId: runIdRunDecider, settlement: { status: 'succeeded', output: { summary: 'tally of {}' } } },
  ],
});

const context = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'runtime',
  runId: runIdRunDecider,
  definitionType: 'workflow',
  definitionName: 'tally',
  definitionVersion: 1,
};

const baseline: readonly (typeof RunLogRecordSchema.Type)[] = [{ type: 'input_applied', data: theRunEnded, context }];

const answer = { sha256: '5493cce2f02de8b015efecff023fac40fdba4b6b3df76c099d2ffed5809ff255', bytes: 30_011 };

const nextArguments = { sha256: '07f5efc18ae1019eb62fc6d2c99f6f30ac37c91c80b6604a115b3ad98c14ddfd', bytes: 20_027 };

const theAnswerKept = Schema.decodeUnknownSync(Schema.toCodecJson(RunLogEventSchema))({
  type: 'input_applied',
  format: 12,
  receipt: {
    kind: 'call_answered',
    key: `["${runIdRunDecider}","/do/0/first",1]`,
    at: 1_790_845_380_200,
    status: 'succeeded',
  },
  steps: [
    {
      reference: '/do/0/first',
      run: 1,
      outcome: 'completed',
      name: 'first',
      times: 1,
      caused_by: { reference: '/do/0/first', run: 1, outcome: 'waiting', times: 1 },
    },
  ],
  resumed: { reference: '/do/0/first', run: 1, times: 1 },
  patch: [
    { op: 'replace', path: '/inputs', value: 2 },
    { op: 'add', path: '/machine/values/3', value: answer },
    { op: 'add', path: '/machine/values/4', value: nextArguments },
  ],
  outputs: [
    {
      kind: 'start_call',
      key: { runId: runIdRunDecider, reference: '/do/1/second', run: 1 },
      function: 'run_definition',
      arguments_sha256: nextArguments.sha256,
      arguments_bytes: nextArguments.bytes,
      longestMs: 600_000,
    },
  ],
  kept: [answer, nextArguments],
});

const valuesKept: readonly (typeof RunLogRecordSchema.Type)[] = [
  { type: 'input_applied', data: theAnswerKept, context },
];

const inputs: readonly RunInput[] = [
  started,
  { kind: 'timer_fired', runId, at, timerId: armedTimer },
  { kind: 'call_answered', runId, at, key: openCall, result: { status: 'failed', detail: 'boom' } },
  {
    kind: 'call_answered',
    runId,
    at,
    key: openCall,
    result: {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'no',
      kind: 'tool_not_offered',
      because: 'tool_not_allowed',
    },
  },
  {
    kind: 'call_answered',
    runId,
    at,
    key: openCall,
    result: { status: 'rejected', reason: 'conflict', detail: 'no', kind: 'tools_called' },
  },
  {
    kind: 'call_answered',
    runId,
    at,
    key: openCall,
    result: { status: 'rejected', reason: 'conflict', detail: 'no' },
  },
  { kind: 'event_received', runId, at, event: { id: 'event-9', type: 'com.acme.approval' } },
  { kind: 'cancel_requested', runId, at, cancel: testCancel },
];

interface Named {
  readonly sha256: string;
  readonly bytes: number;
}

const holders = contentHoldersOf([RunLogRecordSchema]);

const declaration = holders.get('input_applied') ?? {};

const codec = Schema.toCodecJson(RunLogEventSchema);

const readEvent = Schema.decodeUnknownSync(codec);

const writeEvent = Schema.encodeSync(codec);

const utf8 = new TextEncoder();

const keptArguments: Named = { sha256: 'e'.repeat(64), bytes: 20_000 };

function startingWith(kept: readonly Named[]) {
  return readEvent({
    type: 'input_applied',
    format: stateFormatKeepingPayloads,
    receipt: { kind: 'timer_fired', key: '1', at },
    steps: [],
    resumed: null,
    patch: [{ op: 'replace', path: '/inputs', value: 2 }],
    outputs: [
      {
        kind: 'start_call',
        key: openCall,
        function: 'notify',
        arguments_sha256: keptArguments.sha256,
        arguments_bytes: keptArguments.bytes,
        longestMs: 1000,
      },
    ],
    kept,
  });
}

interface Measured {
  readonly byTheEngine: number;
  readonly byTheLedger: number;
  readonly outside: number;
}

function measuredBothWays(kept: readonly Named[]): Measured {
  const event = startingWith(kept);
  const data = writeEvent(event);
  const stored = utf8.encode(JSON.stringify(data)).byteLength;
  const byTheEngine = eventBytesOf(event);
  return {
    byTheEngine,
    byTheLedger: stored + payloadBytesOf(holders, { type: 'input_applied', data }),
    outside: byTheEngine - stored,
  };
}

describe("the facts of a workflow's run log", () => {
  recordedFactsBehaviour({
    schema: RunLogRecordSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline, '0.58.0': valuesKept },
  });
});

describe('the receipt of an input', () => {
  it('names the input by the key it is deduplicated by, with the status of an answer, the kind and because of a rejection, or the type of an event', () => {
    expect(inputs.map((input) => receiptOf(input, at))).toEqual([
      { kind: 'started', key: runId, at },
      { kind: 'timer_fired', key: armedTimer, at },
      { kind: 'call_answered', key: callKeyText(openCall), at, status: 'failed' },
      {
        kind: 'call_answered',
        key: callKeyText(openCall),
        at,
        status: 'rejected',
        rejection: { kind: 'tool_not_offered', because: 'tool_not_allowed' },
      },
      {
        kind: 'call_answered',
        key: callKeyText(openCall),
        at,
        status: 'rejected',
        rejection: { kind: 'tools_called' },
      },
      { kind: 'call_answered', key: callKeyText(openCall), at, status: 'rejected' },
      { kind: 'event_received', key: 'event-9', at, eventType: 'com.acme.approval' },
      { kind: 'cancel_requested', key: runId, at, cancel: { by: 'tester', kind: 'requested' } },
    ]);
  });
});

describe('the time of an input', () => {
  it('never goes back: an input whose clock is behind the last input takes the time of that input', () => {
    const later = { ...runningState, lastInputAt: at + 5000 };

    expect(inputTimeOf(later, started)).toBe(at + 5000);
    expect(inputTimeOf(runningState, { kind: 'cancel_requested', runId, at: at + 1, cancel: testCancel })).toBe(at + 1);
    expect([clampedAt(at, at - 1), clampedAt(at, at + 1)]).toEqual([at, at + 1]);
  });

  it('is never before the time a fired timer was due, so a timer that fires early still fires at its time', () => {
    const early: RunInput = { kind: 'timer_fired', runId, at, timerId: armedTimer };
    const unknown: RunInput = { kind: 'timer_fired', runId, at, timerId: '9' };

    expect([inputTimeOf(runningState, early), inputTimeOf(runningState, unknown)]).toEqual([at + 60_000, at]);
  });
});

describe('the record of an input of format 12', () => {
  it('names, through the start’s own place, arguments that no value its patch adds names, so the ledger holds them; and both places when a value it adds is the same text', () => {
    expect(payloadsNamed(writeEvent(startingWith([])), declaration)).toEqual([keptArguments]);
    expect(payloadsNamed(writeEvent(startingWith([keptArguments])), declaration)).toEqual([
      keptArguments,
      keptArguments,
    ]);
  });

  it('is measured by the engine as the ledger measures it: the text of its data and the bytes every declared place names', () => {
    const measured = [measuredBothWays([]), measuredBothWays([keptArguments])];

    expect(measured.map(({ byTheEngine, byTheLedger }) => byTheEngine - byTheLedger)).toEqual([0, 0]);
    expect(measured.map(({ outside }) => outside)).toEqual([20_000, 40_000]);
  });
});
