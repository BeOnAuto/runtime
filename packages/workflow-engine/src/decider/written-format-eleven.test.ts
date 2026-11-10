import { CallResultSchema } from '@on.auto/operations';
import { Arbitrary, Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { formatElevenRefusalsOf } from '../frozen-testing/format-eleven-refusals.ts';
import { ReceivedEventSchema } from '../inbox/received-event.ts';
import { CancelOrderSchema, RunLimitsSchema } from '../machine/run-input.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

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

describe('a run decided while its engine keeps nothing outside', () => {
  it('writes, for any limits, attributes, input, answer, event and cancel the current schemas take, events and states that the frozen schemas of format 11 read strictly', () => {
    const refused = samples.flatMap((sample, index) =>
      formatElevenRefusalsOf(eventsOf(sample)).map((refusal) => `sample ${index}, ${refusal}`),
    );

    expect(samples.length).toBe(60);
    expect(refused).toEqual([]);
  });
});
