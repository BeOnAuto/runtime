import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Schema } from 'effect';
import { describe } from 'vitest';

import { RunLogEventSchema } from '../run-log/run-event.ts';
import { RunLogRecordSchema } from './run-decider.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-000000000316';

const theRunEnded = Schema.decodeUnknownSync(Schema.toCodecJson(RunLogEventSchema))({
  type: 'input_applied',
  format: 10,
  receipt: { kind: 'call_answered', key: `["${runId}","/do/1/second",3]`, at: 1_790_845_380_200, status: 'succeeded' },
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
    { kind: 'cancel_timer', runId, timerId: '1' },
    { kind: 'settle', runId, settlement: { status: 'succeeded', output: { summary: 'tally of {}' } } },
  ],
});

const context = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'runtime',
  runId,
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
  receipt: { kind: 'call_answered', key: `["${runId}","/do/0/first",1]`, at: 1_790_845_380_200, status: 'succeeded' },
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
      key: { runId, reference: '/do/1/second', run: 1 },
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

describe("the facts of a workflow's run log", () => {
  recordedFactsBehaviour({
    schema: RunLogRecordSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline, '0.58.0': valuesKept },
  });
});
