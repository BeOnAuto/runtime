import type { MemoryLedger } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aReader, createdIn, createdInTurn, executedIn } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionFromTheReadModel } from './read-model-definitions.ts';
import { listFromTheReadModel } from './read-model-lists.ts';
import { referencesTo } from './read-model-rows.ts';
import { versionFromTheReadModel } from './read-model-versions.ts';

function aLedger(): MemoryLedger {
  return readModelLedgerOf(['echo', 'workflow', 'probe']);
}

const usingTheTarget = {
  calls: [{ type: 'echo', name: 'target', steps: [{ number: 2, name: 'greet' }] }],
  reads: [{ type: 'echo', name: 'target' }],
};

async function usedByFour(ledger: MemoryLedger): Promise<void> {
  await createdInTurn(ledger.service, ['target', 'beta', 'alpha'], usingTheTarget);
  await Promise.all(
    ['workflow', 'probe'].map((type) =>
      executedIn(ledger.service, type, {
        type: 'create',
        name: 'user',
        content: { source: '{}', details: usingTheTarget },
        created_by: aReader,
        definition_id: 'id-of-it',
      }),
    ),
  );
}

describe('the readers of the read model', () => {
  it('answer a definition and a list of its type, the retired ones when asked', async () => {
    const ledger = aLedger();
    await createdIn(ledger.service, 'zeta');
    await createdIn(ledger.service, 'alpha-one');
    await executedIn(ledger.service, 'echo', { type: 'retire', name: 'zeta' });
    await executedIn(ledger.service, 'echo', {
      type: 'pause',
      name: 'alpha-one',
      paused_by: aReader,
      reason: 'checked',
    });

    const read = await inThePlaybook(ledger, definitionFromTheReadModel(echo, ['echo'], 'alpha-one'));
    const listed = await inThePlaybook(ledger, listFromTheReadModel(echo, false));
    const everyOne = await inThePlaybook(ledger, listFromTheReadModel(echo, true));

    expect([
      read.definition.name,
      read.definition.source,
      read.definition.reason,
      listed.map(({ name }) => name),
    ]).toEqual(['alpha-one', '{"greeting":"alpha-one"}', 'checked', ['alpha-one']]);
    expect(everyOne.map(({ name, status }) => [name, status])).toEqual([
      ['alpha-one', 'paused'],
      ['zeta', 'retired'],
    ]);
  });
});

describe('the readers of the read model, asked for what the playbook does not hold', () => {
  it('refuse a definition or a version the playbook does not hold, as the registry refuses it', async () => {
    const ledger = aLedger();
    await createdIn(ledger.service, 'alpha-one');

    await expect(inThePlaybook(ledger, definitionFromTheReadModel(echo, ['echo'], 'nobody'))).rejects.toMatchObject({
      detail: 'There is no echo definition nobody in this playbook',
    });
    await expect(inThePlaybook(ledger, versionFromTheReadModel('echo', 'alpha-one', 2))).rejects.toMatchObject({
      detail: 'There is no version 2 of the echo definition alpha-one in this playbook',
    });
  });
});

const callingTheFirst = { calls: [{ type: 'echo', name: 'greeter-000', steps: [{ number: 1, name: 'greet' }] }] };

describe('the readers of the read model, over more rows than a page', () => {
  it('read every row of a type and every user of a definition, a page of a hundred at a time', async () => {
    const ledger = aLedger();
    const names = Array.from({ length: 102 }, (_, index) => `greeter-${String(index).padStart(3, '0')}`);
    await createdInTurn(ledger.service, names, callingTheFirst);

    expect([
      (await inThePlaybook(ledger, listFromTheReadModel(echo, false))).length,
      (await inThePlaybook(ledger, referencesTo('echo', 'greeter-000'))).length,
    ]).toEqual([102, 102]);
  });
});

describe('the users of a definition, read from the read model', () => {
  it('are ordered by the type of each user, its name and how it uses the definition, itself left out', async () => {
    const ledger = aLedger();
    await usedByFour(ledger);

    const read = await inThePlaybook(ledger, definitionFromTheReadModel(echo, ['echo', 'workflow', 'probe'], 'target'));

    expect(read.definition.used_by?.map(({ type, name, relation }) => [type, name, relation])).toEqual([
      ['workflow', 'user', 'calls'],
      ['workflow', 'user', 'reads'],
      ['echo', 'alpha', 'calls'],
      ['echo', 'alpha', 'reads'],
      ['echo', 'beta', 'calls'],
      ['echo', 'beta', 'reads'],
      ['probe', 'user', 'calls'],
      ['probe', 'user', 'reads'],
    ]);
  });
});
