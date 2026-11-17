import { CallResultSchema } from '@on.auto/operations';
import { Arbitrary, Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { formatElevenRefusalsOf } from '../frozen-testing/format-eleven-refusals.ts';
import { ReceivedEventSchema } from '../inbox/received-event.ts';
import { digestsAddedIn, keptAlong } from '../kept-testing/kept-events.ts';
import { CancelOrderSchema, RunLimitsSchema } from '../machine/run-input.ts';
import type { Responder } from '../memory/memory-executor.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import type { PositionedEvent } from '../run-log/run-event.ts';
import { stateFormatKeepingPayloads } from '../run-log/state-format.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { drivenRun, drivenRunId, type DriveOptions } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

function sized(length: number): string {
  return `'\${ "v".repeat(${length}) }'`;
}

const echoing: Responder = (call) => ({ after: 10, result: { status: 'succeeded', output: { echo: call.arguments } } });

interface Case {
  readonly name: string;
  readonly source: string;
  readonly options?: DriveOptions;
}

const cases: readonly Case[] = [
  {
    name: 'calls with small and large arguments and answers',
    source: `
do:
  - small: { call: notify, with: { to: ada } }
  - large: { call: notify, with: { to: ${sized(17_000)} } }
  - pause: { wait: PT1M }
  - last: { set: '\${ ({ length: JSON.stringify($data).length }) }' }
`,
  },
  {
    name: 'a loop that holds a large value for each item across a yield',
    source: `
do:
  - each:
      for: { in: '\${ Array.from({ length: 3 }, (_, index) => index) }' }
      do:
        - grow: { set: '\${ ({ item: $item, text: "w".repeat(17000 + $item) }) }' }
        - pause: { wait: PT1S }
`,
  },
  {
    name: 'a fork whose branches wait on calls of either size',
    source: `
do:
  - both:
      fork:
        branches:
          - left: { call: notify, with: { to: ${sized(18_000)} } }
          - right: { call: notify, with: { to: bob } }
  - rest: { wait: PT1M }
`,
  },
  {
    name: 'a try that catches a raise and recovers with a large value',
    source: `
do:
  - guarded:
      try:
        - make: { set: { text: ${sized(20_000)} } }
        - fail: { raise: { error: { type: https://example.com/busy, status: 503 } } }
      catch:
        do:
          - recover: { set: { text: ${sized(19_000)} } }
  - pause: { wait: PT1M }
`,
  },
  {
    name: 'a listen that takes a large event and an emit',
    source: `
do:
  - await: { listen: { to: { one: { with: { type: go } } } }, timeout: { after: PT1H } }
  - tell: { emit: { event: { with: { type: com.acme.seen, source: /acme, data: { seen: true } } } } }
  - pause: { wait: PT1M }
`,
    options: {
      meanwhile: (driver, runId) => {
        driver.at(5, () => {
          driver.deliver(runId, { id: 'e1', type: 'go', data: 'g'.repeat(20_000) });
        });
      },
    },
  },
  {
    name: 'a large input held for the whole run',
    source: 'do:\n  - pause: { wait: PT1M }\n  - again: { wait: PT1M }',
    options: { input: { text: 'i'.repeat(30_000) } },
  },
];

function driven({ source, options = {} }: Case, payloadOffloading: boolean) {
  return drivenRun(workflow(source), { respond: echoing, ...options, payloadOffloading });
}

function addedIn(events: readonly PositionedEvent[]): readonly (readonly string[])[] {
  return events.map(({ event }) => [...new Set(digestsAddedIn(event))]);
}

const SampledSchema = Schema.Struct({
  limits: RunLimitsSchema,
  attributes: Schema.JsonObject,
  input: Schema.Json,
  result: CallResultSchema,
  event: ReceivedEventSchema,
  cancel: CancelOrderSchema,
});

type Sampled = typeof SampledSchema.Type;

const samples = Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(SampledSchema), { count: 60, seed: 11 }));

const asking = workflow(`
do:
  - ask: { call: notify, with: { to: ada } }
  - await: { listen: { to: { one: { with: { type: go } } } } }
  - pause: { wait: PT1M }
`);

function eventsOf({ limits, attributes, input, result, event, cancel }: Sampled) {
  const driver = memoryDriver({ sandbox: testSandbox, respond: () => ({ after: 10, result }) });
  const lasting = { ...limits, mostDurationMs: 600_000, longestCallMs: 60_000 };
  driver.start({ runId: drivenRunId, document: asking, input, limits: lasting, attributes });
  driver.at(20, () => {
    driver.deliver(drivenRunId, { ...event, type: 'go' });
  });
  driver.at(40, () => {
    driver.cancel(drivenRunId, cancel);
  });
  driver.runUntilEnded(drivenRunId);
  return driver.ports.runStore.events(drivenRunId).map(({ event: written }) => written);
}

describe.each(cases)('the events a decider writes for $name', (example) => {
  it('are of format 11 with its engine keeping nothing outside, each event and each state they make read strictly by the frozen schemas of format 11, those of the release before', () => {
    const run = driven(example, false);

    expect(run.events.length).toBeGreaterThan(1);
    expect(formatElevenRefusalsOf(run.events.map(({ event }) => event))).toEqual([]);
  });

  it('are of format 12 with its engine keeping values outside, each naming in kept exactly the payloads of the values it adds, once and in order', () => {
    const run = driven(example, true);
    const kept = keptAlong(run.events);

    expect(run.events.map(({ event }) => event.format)).toEqual(run.events.map(() => stateFormatKeepingPayloads));
    expect(kept).toEqual(addedIn(run.events));
    expect(kept.flat().length).toBeGreaterThan(0);
    expect(run.outcome).toEqual(driven(example, false).outcome);
  });
});

describe('a run decided while its engine keeps nothing outside', () => {
  it('writes, for any limits, attributes, input, answer, event and cancel the current schemas take, events and states that the frozen schemas of format 11 read strictly', () => {
    const refused = samples.flatMap((sample, index) =>
      formatElevenRefusalsOf(eventsOf(sample)).map((refusal) => `sample ${index}, ${refusal}`),
    );

    expect(samples.length).toBe(60);
    expect(refused).toEqual([]);
  });
});
