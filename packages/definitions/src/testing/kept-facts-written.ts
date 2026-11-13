import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { RunEventSchema } from '../runs/run-events.ts';
import { answering, asked, askedLineage, askedRun } from './asked-runs.ts';
import { acmeAdmin } from './callers.ts';
import { echo } from './capabilities/echo.ts';
import { prompted } from './capabilities/prompted.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook } from './harness.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

type RecordedRunFact = typeof RunEventSchema.Type;

const recordedRunFactOf = Schema.decodeUnknownSync(RunEventSchema);

const keptTypes: ReadonlySet<string> = new Set(['run_started', 'run_succeeded', 'request_answered']);

const toAlpha = toPlaybook('acme', 'alpha');

interface Ran {
  readonly capability: Capability;
  readonly input: Schema.Json;
  readonly kept: ReadonlySet<string>;
}

async function keptWhileRunning({ capability, input, kept }: Ran): Promise<readonly RecordedRunFact[]> {
  const definitions = harness();
  const { createDefinition, runDefinition } = definitionOperationsFor([capability]);
  const { type } = capability;
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type, name: 'greet', source: '{"greeting": "Hi"}' }));
  const request = toAlpha(acmeAdmin, { type, name: 'greet', input, run_id: runId });
  await definitions.run(
    definitions.dispatch(runDefinition, request).pipe(Effect.provideService(PayloadOffloading, true)),
  );
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(alpha, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
  );
  return records
    .filter((record) => kept.has(record.type))
    .map((record) => recordedRunFactOf({ type: record.type, data: record.data, context: record.context }));
}

function startedAndSucceeded(): Promise<readonly RecordedRunFact[]> {
  return keptWhileRunning({ capability: echo, input: { notes: 'n'.repeat(17_000) }, kept: keptTypes });
}

function keptPromptWritten(): Promise<readonly RecordedRunFact[]> {
  const prompt = { instructions: 'Qualify the lead.', message: 'm'.repeat(17_000), truncated: false };
  return keptWhileRunning({
    capability: prompted,
    input: { record: { duration_ms: 2100, prompt } },
    kept: new Set(['run_succeeded']),
  });
}

export const recordHoldingItsPrompt = {
  model: 'example/model-large',
  usage: {
    input: { total: 1200, uncached: 200, cache_read: 1000, cache_write: 0 },
    output: { total: 300, text: 250, reasoning: 50 },
    total: 1500,
  },
  cost_usd: 0.012,
  duration_ms: 2100,
  prompt: { instructions: 'Qualify the lead.', message: 'Lead lead-1 asked for a quote.', truncated: false },
};

export async function keptFactsWritten(): Promise<Readonly<Record<string, readonly RecordedRunFact[]>>> {
  const { record, recorded, run } = await asked();
  const answered = record(
    askedRun,
    answering({ approved: true, notes: 'a'.repeat(17_000) }, 'request-1'),
    askedLineage,
  );
  await run(Effect.orDie(answered.pipe(Effect.provideService(PayloadOffloading, true))));
  const answers = (await recorded())
    .filter(({ type }) => type === 'request_answered')
    .map(({ type, data, context }) => recordedRunFactOf({ type, data, context }));
  return { '0.58.0': [...(await startedAndSucceeded()), ...answers], '0.62.0': await keptPromptWritten() };
}
