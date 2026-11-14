import { describe, expect, it } from 'vitest';

import { earlierDefinitionIdOf } from '../identity/definition-ids.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aReader } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { answeringAsTheReleaseBefore, savedBeforeIds } from '../read-model-testing/saved-before-ids.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionFromTheReadModel } from './read-model-definitions.ts';
import { listFromTheReadModel } from './read-model-lists.ts';

describe('the readers of the read model, of a definition created before definitions had ids', () => {
  it('answer the id of the address it was created at, in a read and in a list, before and after it is saved again', async () => {
    const ledger = readModelLedgerOf(['echo']);
    const itsId = earlierDefinitionIdOf({ org: 'acme', playbook: 'alpha', type: 'echo', name: 'earlier' });
    await savedBeforeIds(ledger, {
      type: 'create',
      name: 'earlier',
      content: { source: '{}' },
      created_by: aReader,
      definition_id: 'never-recorded',
    });
    const created = await inThePlaybook(ledger, definitionFromTheReadModel(echo, ['echo'], 'earlier'));
    await savedBeforeIds(ledger, { type: 'update', name: 'earlier', content: { source: '{"again":true}' } });

    const read = await inThePlaybook(ledger, definitionFromTheReadModel(echo, ['echo'], 'earlier'));
    const listed = await inThePlaybook(ledger, listFromTheReadModel(echo, false));

    expect([created.definition.definition_id, read.definition.version, read.definition.definition_id]).toEqual([
      itsId,
      2,
      itsId,
    ]);
    expect(listed.map(({ definition_id: id }) => id)).toEqual([itsId]);
  });
});

describe('the readers of the read model, answered by an object of the release before, whose rows have no column of ids', () => {
  it('answer the id of the address each definition was created at, every definition of such an object being earlier', async () => {
    const ledger = readModelLedgerOf(['echo']);
    await savedBeforeIds(ledger, {
      type: 'create',
      name: 'earlier',
      content: { source: '{}' },
      created_by: aReader,
      definition_id: 'never-recorded',
    });

    const read = await inThePlaybook(
      answeringAsTheReleaseBefore(ledger),
      definitionFromTheReadModel(echo, ['echo'], 'earlier'),
    );

    expect(read.definition.definition_id).toBe(
      earlierDefinitionIdOf({ org: 'acme', playbook: 'alpha', type: 'echo', name: 'earlier' }),
    );
  });
});
