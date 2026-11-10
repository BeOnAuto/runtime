import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { keptArmOf, keptIn, keptLongBeforeAndLost, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';
import { admittingMeter } from '../testing/recording-meter.ts';

const { createDefinition, runDefinition, getRun } = definitionOperationsFor([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const input = { who: 'Ada' };

const output = { greeting: 'Hi', input, letter: 'x'.repeat(4096) };

const kept = keptArmOf(output);

const onTheRun = {
  runId,
  by: 'acme-admin',
  at: firstMoment,
  definitionType: 'echo',
  definitionName: 'greet',
  definitionVersion: 1,
};

async function withAKeptOutput(keeps: boolean) {
  const watched = watchedStore();
  const definitions = harness(admittingMeter, watched.store);
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  const { service } = definitions.ledger;
  await Effect.runPromise(
    Effect.all([
      keeps
        ? keptIn(service.content, alpha, output)
        : keptLongBeforeAndLost(service.content, watched.store, alpha, output),
      recordedAsGiven(
        service,
        `playbook/acme/alpha/runs/${runId}`,
        [
          { type: 'run_started', data: { input, started_by: recordedAdmin } },
          { type: 'run_succeeded', data: { output_sha256: kept.sha256, output_bytes: kept.bytes, record: {} } },
        ],
        onTheRun,
      ),
    ]),
  );
  return { definitions, watched };
}

const succeeded = { run_id: runId, type: 'echo', name: 'greet', status: 'succeeded' };

describe('a run whose output its playbook keeps outside the run', () => {
  it('is answered by get_run with its output, read once from the content of its playbook', async () => {
    const { definitions, watched } = await withAKeptOutput(true);

    expect(await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'succeeded',
      output: { ...succeeded, output },
    });
    expect(watched.reads()).toBe(1);
  });

  it('is answered by run_definition, asked again with its id and input, with its output read', async () => {
    const { definitions } = await withAKeptOutput(true);

    expect(
      await definitions.call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input, run_id: runId })),
    ).toMatchObject({ status: 'succeeded', output: { ...succeeded, output } });
  });

  it('is answered with the digest and size of an output its playbook no longer holds, in place of the output', async () => {
    const { definitions } = await withAKeptOutput(false);
    const answered = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));

    expect(answered).toMatchObject({
      status: 'succeeded',
      output: { ...succeeded, output_sha256: kept.sha256, output_bytes: kept.bytes },
    });
    expect(answered).not.toHaveProperty('output.output');
  });

  it('is unavailable, to be asked again, while the store of its content does not answer', async () => {
    const { definitions, watched } = await withAKeptOutput(true);
    watched.fail();

    expect(await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail:
        "The run's output, which its playbook keeps outside the run's record, could not be read just now; ask again in a moment",
    });
  });
});
