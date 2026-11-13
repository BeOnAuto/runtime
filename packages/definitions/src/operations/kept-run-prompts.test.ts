import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { prompted } from '../testing/capabilities/prompted.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { keptArmOf, keptIn, keptLongBeforeAndLost, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';
import { admittingMeter } from '../testing/recording-meter.ts';

const { createDefinition, runDefinition, getRun } = definitionOperationsFor([prompted]);

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const prompt = { instructions: 'Be brief.', message: 'm'.repeat(17_000), truncated: false };

const kept = keptArmOf(prompt);

const input = { record: { model: 'm', prompt } };

const onTheRun = {
  runId,
  by: 'acme-admin',
  at: firstMoment,
  definitionType: 'prompted',
  definitionName: 'ask',
  definitionVersion: 1,
};

async function withAKeptPrompt(keeps: boolean) {
  const watched = watchedStore();
  const definitions = harness(admittingMeter, watched.store);
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'prompted', name: 'ask', source: '{"greeting": "Hi"}' }),
  );
  const { service } = definitions.ledger;
  await Effect.runPromise(
    Effect.all([
      keeps
        ? keptIn(service.content, alpha, prompt)
        : keptLongBeforeAndLost(service.content, watched.store, alpha, prompt),
      recordedAsGiven(
        service,
        `playbook/acme/alpha/runs/${runId}`,
        [
          { type: 'run_started', data: { input, started_by: recordedAdmin } },
          {
            type: 'run_succeeded',
            data: {
              output: { greeting: 'Hi', answer: null },
              record: { model: 'm', prompt_sha256: kept.sha256, prompt_bytes: kept.bytes },
            },
          },
        ],
        onTheRun,
      ),
    ]),
  );
  return { definitions, watched };
}

const succeeded = { run_id: runId, type: 'prompted', name: 'ask', status: 'succeeded' };

const asStored = { model: 'm', prompt_sha256: kept.sha256, prompt_bytes: kept.bytes };

describe('a run whose prompt its playbook keeps outside the run', () => {
  it('is answered by get_run with its prompt in its record, read once from the content of its playbook', async () => {
    const { definitions, watched } = await withAKeptPrompt(true);

    const answered = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));

    expect(answered).toMatchObject({ status: 'succeeded', output: { ...succeeded, record: { model: 'm', prompt } } });
    expect(answered).not.toHaveProperty('output.record.prompt_sha256');
    expect(watched.reads()).toBe(1);
  });

  it('is answered by run_definition, asked again with its id and input, with its prompt read', async () => {
    const { definitions } = await withAKeptPrompt(true);

    expect(
      await definitions.call(
        runDefinition,
        toAlpha(acmeAdmin, { type: 'prompted', name: 'ask', input, run_id: runId }),
      ),
    ).toMatchObject({ status: 'succeeded', output: { ...succeeded, record: { model: 'm', prompt } } });
  });

  it('is answered with the digest and size of a prompt its playbook no longer holds, in the place of the prompt', async () => {
    const { definitions } = await withAKeptPrompt(false);

    expect(await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'succeeded',
      output: { ...succeeded, record: asStored },
    });
  });

  it('is answered all the same, with the digest and size of its prompt, while the store of its content does not answer', async () => {
    const { definitions, watched } = await withAKeptPrompt(true);
    watched.fail();

    const answered = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));

    expect(answered).toMatchObject({ status: 'succeeded', output: { ...succeeded, record: asStored } });
    expect(answered).not.toHaveProperty('output.record.prompt');
  });
});
