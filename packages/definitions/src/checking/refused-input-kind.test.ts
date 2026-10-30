import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-777777777772';

const tooFewSeats = { pointer: '/input/seats', detail: 'seats: expected at least 1.' };

const refused = {
  reason: 'invalid_input',
  detail: tooFewSeats.detail,
  issues: [tooFewSeats],
  kind: 'input_schema',
};

async function playbookWithASeatedProbe() {
  const operations = definitionOperationsFor([probe().capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }),
  );
  const run = (seats: number) =>
    definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'probe', name: 'plain', input: { seats }, run_id: runId }),
    );
  const read = (operation: Parameters<typeof definitions.call>[0]) =>
    definitions.call(operation, toAlpha(acmeAdmin, { run_id: runId }));
  return { ...definitions, ...operations, run, read };
}

describe('a run whose input its input schema refused', () => {
  it('is rejected of the kind input_schema, which get_run shows and a retry under its run id answers again', async () => {
    const { run, read, getRun } = await playbookWithASeatedProbe();

    const ran = await run(0);
    const retried = await run(0);

    expect(ran).toEqual({ status: 'rejected', ...refused });
    expect(retried).toEqual(ran);
    expect(await read(getRun)).toMatchObject({ output: { status: 'rejected', rejection: refused } });
  });

  it('is listed with the kind beside its reason, and its history shows the kind and says it in words', async () => {
    const { run, read, call, listRuns, getRunHistory } = await playbookWithASeatedProbe();
    await run(0);

    expect(await call(listRuns, toAlpha(acmeAdmin, {}))).toMatchObject({
      output: { runs: [{ run_id: runId, rejection: { reason: 'invalid_input', kind: 'input_schema' } }] },
    });
    expect(await read(getRunHistory)).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          {
            type: 'run_rejected',
            summary: 'A run did not go through: what was given does not fit what it needs.',
            data: { ...refused, issue_count: 1 },
          },
        ],
      },
    });
  });

  it('runs on an input its input schema takes', async () => {
    const { run } = await playbookWithASeatedProbe();

    expect(await run(2)).toMatchObject({ output: { status: 'succeeded', output: { seats: 2 } } });
  });
});
