import { describe, expect, it } from 'vitest';

import { loadRegistry } from '../operations/registry-access.ts';
import { definitionFromTheReadModel } from '../read-model-reads/read-model-definitions.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aReader } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { savedBeforeIds, savedToday } from '../read-model-testing/saved-before-ids.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionKeyOfId, earlierDefinitionIdOf } from './definition-ids.ts';

function refused(tag: string, fields: object = {}): unknown {
  return expect.objectContaining({ _tag: tag, ...fields });
}

describe('the id of a definition made before definitions had ids of their own', () => {
  it('is a version 5 UUID of the org, the playbook, the type and the name its creation was recorded under, fixed for ever', () => {
    const closing = { org: 'acme', playbook: 'alpha', type: 'workflow', name: 'close-the-week' };

    expect([earlierDefinitionIdOf(closing), earlierDefinitionIdOf({ ...closing, playbook: 'beta' })]).toEqual([
      '129b8fef-e8c0-5a85-914a-f139cfd61d86',
      'd7126a43-3768-5f58-b497-6924bb0a96c1',
    ]);
  });

  it("gives the key of the definition's streams under its org", () => {
    expect(definitionKeyOfId('acme', '129b8fef-e8c0-5a85-914a-f139cfd61d86')).toBe(
      'definition/acme/129b8fef-e8c0-5a85-914a-f139cfd61d86/',
    );
  });
});

const itsId = earlierDefinitionIdOf({ org: 'acme', playbook: 'alpha', type: 'echo', name: 'earlier' });

describe('a definition created before definitions had ids, saved, paused and retired by today’s decisions', () => {
  it('keeps one name under the key of its address, which the registry and the read model answer as its id, and keeps it retired', async () => {
    const ledger = readModelLedgerOf(['echo']);
    await savedBeforeIds(ledger, {
      type: 'create',
      name: 'earlier',
      content: { source: '{}' },
      created_by: aReader,
      definition_id: 'never-recorded',
    });
    const saved = [
      await savedToday(ledger, { type: 'update', name: 'earlier', content: { source: '{"again":true}' } }),
      await savedToday(ledger, { type: 'pause', name: 'earlier', paused_by: aReader }),
    ];
    const whilePaused = ledger.names().map(({ definitionKey, status }) => [definitionKey, status]);
    const registered = (await inThePlaybook(ledger, loadRegistry('echo'))).get('earlier')?.definition_id;
    const read = await inThePlaybook(ledger, definitionFromTheReadModel(echo, ['echo'], 'earlier'));
    await savedToday(ledger, { type: 'retire', name: 'earlier' });

    const again = await savedToday(ledger, {
      type: 'create',
      name: 'earlier',
      content: { source: '{}' },
      created_by: aReader,
      definition_id: 'another',
    });

    expect([saved, whilePaused, registered, read.definition.definition_id]).toEqual([
      [null, null],
      [[definitionKeyOfId('acme', itsId), 'paused']],
      itsId,
      itsId,
    ]);
    expect([ledger.names().map(({ definitionKey, status }) => [definitionKey, status]), again]).toEqual([
      [[definitionKeyOfId('acme', itsId), 'retired']],
      refused('conflict', { kind: 'taken' }),
    ]);
  });
});
