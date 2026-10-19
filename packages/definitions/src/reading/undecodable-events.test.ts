import { ActedOnRunContextSchema, factOf, type Decided, type Decider } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const BrokenSchema = factOf('run_started', Schema.Struct({ at: Schema.String }), ActedOnRunContextSchema);

const broken: Decider<null, Decided<typeof BrokenSchema.Type>, typeof BrokenSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  decide: (event) => Result.succeed([event]),
  context: () => ({ at: '2026-10-01T09:00:00.000Z', by: 'acme-admin', runId }),
  eventSchema: BrokenSchema,
};

describe('a stored event of a run that no longer decodes', () => {
  it('fails the list of runs and the read of its history', async () => {
    const { getRunHistory, listRuns } = definitionOperationsFor([echo]);
    const { call, ledger, run } = harness();
    await run(
      Effect.orDie(
        ledger.service.execute(`playbook/acme/alpha/runs/${runId}`, broken, {
          type: 'run_started',
          data: { at: '2026-10-01T09:00:00.000Z' },
        }),
      ),
    );

    expect(await call(getRunHistory, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'failed',
    });
    expect(await call(listRuns, toAlpha(acmeAdmin))).toMatchObject({ status: 'failed' });
  });
});
