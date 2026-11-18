import type { MemoryLedger } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aReader, executedIn } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { answeringAsTheReleaseBefore } from '../read-model-testing/release-before.ts';
import { echoingWorkflow } from '../testing/capabilities/paged.ts';
import { listFromTheReadModel } from './read-model-lists.ts';

const contributes = [{ goal: 'kept-going', purpose: 'Counts the runs that ended.', measures: '/ended', final: true }];

async function aContributingWorkflow(): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(['workflow']);
  await executedIn(ledger.service, 'workflow', {
    type: 'create',
    name: 'weekly',
    content: { source: '{}', details: { shape: 'table', contributes } },
    created_by: aReader,
    definition_id: 'id-of-weekly',
  });
  return ledger;
}

async function detailsListed(ledger: MemoryLedger, goals: boolean): Promise<readonly unknown[]> {
  const listed = await inThePlaybook(ledger, listFromTheReadModel(echoingWorkflow, false, goals));
  return listed.map(({ details }) => details);
}

describe('a list of workflows read from the read model of the current definitions', () => {
  it('answers what each workflow contributes where goals are kept, and its shape alone where they are not', async () => {
    const ledger = await aContributingWorkflow();

    expect([await detailsListed(ledger, true), await detailsListed(ledger, false)]).toEqual([
      [{ shape: 'table', contributes }],
      [{ shape: 'table' }],
    ]);
  });

  it('answers no contributions, and does not fail, from an object of the release before, whose rows have no column of them', async () => {
    const ledger = await aContributingWorkflow();

    expect(await detailsListed(answeringAsTheReleaseBefore(ledger, 'contributes'), true)).toEqual([{ shape: 'table' }]);
  });
});
