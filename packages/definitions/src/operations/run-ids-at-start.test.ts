import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';

const { createDefinition, runDefinition, getRun } = definitionOperationsFor([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const toBeta = toPlaybook('acme', 'beta');

const toGamma = toPlaybook('globex', 'gamma');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const heldElsewhere = {
  status: 'rejected',
  reason: 'conflict',
  detail: 'The run id belongs to a run of another definition or with another input',
};

async function withTwoDefinitions(second: typeof toAlpha, caller = acmeAdmin): Promise<Harness> {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
  );
  await definitions.call(
    createDefinition,
    second(caller, { type: 'echo', name: 'wave', source: '{"greeting": "Hi"}' }),
  );
  return definitions;
}

function bothAtOnce({ dispatch, run }: Harness, second: typeof toAlpha, caller = acmeAdmin) {
  return run(
    Effect.all(
      [
        dispatch(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: runId })),
        dispatch(runDefinition, second(caller, { type: 'echo', name: 'wave', run_id: runId })),
      ],
      { concurrency: 'unbounded' },
    ),
  );
}

describe('two starts at once under one run id, for two definitions', () => {
  it.each([
    { place: 'of one playbook', second: toAlpha },
    { place: 'of two playbooks of one org', second: toBeta },
  ] as const)(
    'start one run, $place, and refuse the other in the words of a run id held by another',
    async ({ second }) => {
      const definitions = await withTwoDefinitions(second);

      const answers = await bothAtOnce(definitions, second);
      const read = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));

      expect(answers).toMatchObject([
        { status: 'succeeded', output: { name: 'greet', status: 'succeeded' } },
        heldElsewhere,
      ]);
      expect(read).toMatchObject({ status: 'succeeded', output: { name: 'greet', status: 'succeeded' } });
    },
  );

  it('start both where the two definitions are of two orgs', async () => {
    const definitions = await withTwoDefinitions(toGamma, globexAdmin);

    const answers = await bothAtOnce(definitions, toGamma, globexAdmin);

    expect(answers).toMatchObject([
      { status: 'succeeded', output: { name: 'greet', status: 'succeeded' } },
      { status: 'succeeded', output: { name: 'wave', status: 'succeeded' } },
    ]);
  });
});
