import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability } from '../index.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { echoDeclaration } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { keptArmOf, watchedStore } from '../testing/kept-payloads.ts';
import { admittingMeter } from '../testing/recording-meter.ts';

const answeringAtItsLimit = defineCapability({
  ...echoDeclaration,
  type: 'limited',
  run: ({ greeting }, input) =>
    Effect.succeed({
      output: { greeting, input },
      record: { greeting },
      incomplete_details: { reason: 'max_tool_calls' as const },
    }),
});

const promptedAtItsLimit = defineCapability({
  ...echoDeclaration,
  type: 'prompted-limited',
  run: ({ greeting }, input) =>
    Effect.succeed({
      output: { greeting },
      record: { greeting, prompt: input },
      incomplete_details: { reason: 'max_input_tokens' as const },
    }),
});

const { createDefinition, runDefinition, getRun, listRuns } = definitionOperationsFor([
  answeringAtItsLimit,
  promptedAtItsLimit,
]);

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const answered = { incomplete_details: { reason: 'max_tool_calls' } };

async function limited(type = 'limited'): Promise<Harness> {
  const definitions = harness(admittingMeter, watchedStore().store);
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type, name: 'greet', source: '{"greeting": "Hi"}' }));
  return definitions;
}

function ranWith(input: object, type = 'limited') {
  return toAlpha(acmeAdmin, { type, name: 'greet', input, run_id: runId });
}

async function factsOf(definitions: Harness) {
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(alpha, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
  );
  return records.map(({ type, data }) => ({ type, data }));
}

describe('a run whose capability answers with the limit its answer was shaped by', () => {
  it('records the limit on run_succeeded beside its output, and get_run and list_runs read it back', async () => {
    const definitions = await limited();

    expect(await definitions.call(runDefinition, ranWith({ who: 'Ada' }))).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, status: 'succeeded', output: { greeting: 'Hi' }, ...answered },
    });
    expect(await factsOf(definitions)).toEqual([
      { type: 'run_started', data: { input: { who: 'Ada' }, started_by: recordedAdmin } },
      {
        type: 'run_succeeded',
        data: { output: { greeting: 'Hi', input: { who: 'Ada' } }, record: { greeting: 'Hi' }, ...answered },
      },
    ]);
    expect([
      await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId })),
      await definitions.call(listRuns, toAlpha(acmeAdmin)),
    ]).toMatchObject([{ output: answered }, { output: { runs: [answered] } }]);
  });

  it('keeps the limit on the fact when its output is kept outside it', async () => {
    const definitions = await limited();
    const input = { who: 'Ada', notes: 'n'.repeat(17_000) };
    const kept = keptArmOf({ greeting: 'Hi', input });

    await definitions.run(
      definitions.dispatch(runDefinition, ranWith(input)).pipe(Effect.provideService(PayloadOffloading, true)),
    );

    expect((await factsOf(definitions)).at(-1)).toEqual({
      type: 'run_succeeded',
      data: { output_sha256: kept.sha256, output_bytes: kept.bytes, record: { greeting: 'Hi' }, ...answered },
    });
  });
});

describe('a run that answered at its limit with a prompt past 16,384 bytes, where its playbook keeps large values outside its runs', () => {
  it('keeps its prompt by digest, as any run that succeeded does, with the limit beside it', async () => {
    const definitions = await limited('prompted-limited');
    const prompt = { message: 'm'.repeat(17_000), truncated: false };
    const kept = keptArmOf(prompt);
    const atItsBudget = { incomplete_details: { reason: 'max_input_tokens' } };

    const ran = await definitions.run(
      definitions
        .dispatch(runDefinition, ranWith(prompt, 'prompted-limited'))
        .pipe(Effect.provideService(PayloadOffloading, true)),
    );

    expect((await factsOf(definitions)).at(-1)).toEqual({
      type: 'run_succeeded',
      data: {
        output: { greeting: 'Hi' },
        record: { greeting: 'Hi', prompt_sha256: kept.sha256, prompt_bytes: kept.bytes },
        ...atItsBudget,
      },
    });
    expect([ran, await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }))]).toMatchObject([
      { status: 'succeeded', output: { record: { greeting: 'Hi', prompt }, ...atItsBudget } },
      { status: 'succeeded', output: { record: { greeting: 'Hi', prompt }, ...atItsBudget } },
    ]);
  });
});
