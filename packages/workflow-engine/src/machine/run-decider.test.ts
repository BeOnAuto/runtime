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

const baseline: readonly (typeof RunLogRecordSchema.Type)[] = [
  {
    type: 'input_applied',
    data: theRunEnded,
    context: {
      at: '2026-10-29T10:00:00.000Z',
      by: 'runtime',
      runId,
      definitionType: 'workflow',
      definitionName: 'tally',
      definitionVersion: 1,
    },
  },
];

describe("the facts of a workflow's run log", () => {
  recordedFactsBehaviour({
    schema: RunLogRecordSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});
