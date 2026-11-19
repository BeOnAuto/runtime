import { describe, expect, it } from 'vitest';

import { fellBackMessage } from '../read-model-staging/shadow-comparison.ts';
import type { ReadModelStaged } from '../read-model-testing/staged-ledger.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness } from '../testing/harness.ts';
import { ranWeekly } from '../testing/moved-runs.ts';
import { answerOf, callsGreet, inAlpha, operations, toAlpha, weekly } from '../testing/moving.ts';
import { renamedIn } from '../testing/renaming.ts';

const monthly = { type: 'workflow', name: 'monthly' };

const renamedToMonthly = { type: 'workflow', from: 'weekly', to: 'monthly' };

interface ReadPath {
  readonly path: string;
  readonly readModel?: ReadModelStaged;
}

const readPaths: readonly ReadPath[] = [
  { path: 'its facts' },
  { path: 'the read model', readModel: { stage: 'reads', folds: ['echo', 'workflow'] } },
];

describe.each(readPaths)('a workflow renamed by a fact on its stream, read from $path', ({ readModel }) => {
  it('is found by its new name with its id and version, not by its old one, and is listed once under the new', async () => {
    const definitions = harness(undefined, undefined, readModel);
    await inAlpha(definitions);
    const runId = await ranWeekly(definitions);
    const before = answerOf(await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, weekly)));

    await renamedIn(definitions, renamedToMonthly);

    expect([
      await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, monthly)),
      await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, weekly)),
      await definitions.call(operations.listDefinitions, toAlpha(acmeAdmin, { type: 'workflow' })),
      await definitions.call(operations.listRuns, toAlpha(acmeAdmin, monthly)),
      await definitions.call(operations.listRuns, toAlpha(acmeAdmin, weekly)),
      await definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: runId })),
    ]).toMatchObject([
      { status: 'succeeded', output: { name: 'monthly', definition_id: before['definition_id'], version: 2 } },
      { status: 'rejected', reason: 'not_found' },
      { status: 'succeeded', output: { definitions: [{ name: 'monthly', definition_id: before['definition_id'] }] } },
      { status: 'succeeded', output: { runs: [{ run_id: runId, type: 'workflow', name: 'monthly' }] } },
      { status: 'succeeded', output: { runs: [] } },
      { status: 'succeeded', output: { run_id: runId, type: 'workflow', name: 'monthly' } },
    ]);
    expect(definitions.logged().filter(({ message }) => message === fellBackMessage)).toEqual([]);
  });

  it('frees its old name for another definition, and saves its next version under the new', async () => {
    const definitions = harness(undefined, undefined, readModel);
    await inAlpha(definitions);
    await renamedIn(definitions, renamedToMonthly);

    expect([
      await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { ...weekly, source: callsGreet() })),
      await definitions.call(
        operations.updateDefinition,
        toAlpha(acmeAdmin, { ...monthly, source: callsGreet({ again: true }) }),
      ),
      await definitions.call(operations.listDefinitions, toAlpha(acmeAdmin, { type: 'workflow' })),
    ]).toMatchObject([
      { status: 'succeeded', output: { name: 'weekly', version: 1 } },
      { status: 'succeeded', output: { name: 'monthly', version: 3 } },
      { status: 'succeeded', output: { definitions: [{ name: 'monthly' }, { name: 'weekly' }] } },
    ]);
  });
});
