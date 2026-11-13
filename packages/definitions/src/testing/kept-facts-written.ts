import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect, Schema } from 'effect';

import { RunEventSchema } from '../runs/run-events.ts';
import { answering, asked, askedLineage, askedRun } from './asked-runs.ts';
import { acmeAdmin } from './callers.ts';
import { echo } from './capabilities/echo.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook } from './harness.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

type RecordedRunFact = typeof RunEventSchema.Type;

const recordedRunFactOf = Schema.decodeUnknownSync(RunEventSchema);

const keptTypes: ReadonlySet<string> = new Set(['run_started', 'run_succeeded', 'request_answered']);

async function startedAndSucceeded(): Promise<readonly RecordedRunFact[]> {
  const definitions = harness();
  const { createDefinition, runDefinition } = definitionOperationsFor([echo]);
  const toAlpha = toPlaybook('acme', 'alpha');
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  const request = toAlpha(acmeAdmin, {
    type: 'echo',
    name: 'greet',
    input: { notes: 'n'.repeat(17_000) },
    run_id: runId,
  });
  await definitions.run(
    definitions.dispatch(runDefinition, request).pipe(Effect.provideService(PayloadOffloading, true)),
  );
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(alpha, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
  );
  return records
    .filter(({ type }) => keptTypes.has(type))
    .map(({ type, data, context }) => recordedRunFactOf({ type, data, context }));
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

export async function keptFactsWritten(): Promise<readonly RecordedRunFact[]> {
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
  return [...(await startedAndSucceeded()), ...answers];
}
