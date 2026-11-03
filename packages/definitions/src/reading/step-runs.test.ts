import type { Outcome } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const closeTheWeek = '55555555-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const totalTheWeek = '66666666-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const listedIdsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
  }),
);

function idStartsIn(outcome: Outcome): readonly string[] {
  return listedIdsOf(outcome).output.runs.map(({ run_id: id }) => id.slice(0, 8));
}

async function playbookWithAStepsRun() {
  const operations = definitionOperationsFor([echo]);
  const definitions = harness();
  const { call } = definitions;
  const { createDefinition, runDefinition, listRuns } = operations;
  await call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting":"Hi"}' }));
  await call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'wave', source: '{"greeting":"Hey"}' }));
  await call(
    runDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input: {}, run_id: closeTheWeek }),
    '2026-10-01T09:01:00.000Z',
  );
  await call(
    runDefinition,
    {
      ...toAlpha(acmeAdmin, { type: 'echo', name: 'wave', input: {}, run_id: totalTheWeek }),
      calledBy: { run_id: closeTheWeek, reference: '/do/1/total', run: 2 },
    },
    '2026-10-01T09:02:00.000Z',
  );
  const listing = (input: object = {}) => call(listRuns, toAlpha(acmeAdmin, input));
  return { call, listRuns, listing };
}

describe('the runs a step started', () => {
  it('are listed among the others, each within the run and the step that started it, without the leading slash', async () => {
    const { listing } = await playbookWithAStepsRun();

    const listed = await listing();

    expect(listed).toMatchObject({
      output: {
        runs: [
          { run_id: totalTheWeek, within: { run_id: closeTheWeek, step: 'do/1/total' } },
          { run_id: closeTheWeek },
        ],
      },
    });
    expect(listed).not.toHaveProperty('output.runs.1.within');
  });

  it.each([
    [{}, ['66666666', '55555555']],
    [{ steps: true }, ['66666666', '55555555']],
    [{ steps: false }, ['55555555']],
    [{ type: 'echo', name: 'wave', steps: false }, []],
    [{ status: 'succeeded', steps: false }, ['55555555']],
  ] as const)('are kept or left out with the filters %j', async (filters, kept) => {
    const { listing } = await playbookWithAStepsRun();

    expect(idStartsIn(await listing(filters))).toEqual(kept);
  });

  it('are left out by steps=false in a query string', async () => {
    const { call, listRuns } = await playbookWithAStepsRun();

    expect(idStartsIn(await call(listRuns, asQueryString(toAlpha(acmeAdmin, { steps: 'false' }))))).toEqual([
      '55555555',
    ]);
  });
});
