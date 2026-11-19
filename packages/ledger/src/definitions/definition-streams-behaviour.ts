import { SQL } from '@event-driven-io/dumbo';
import { describe, expect, it, onTestFinished } from 'vitest';

import { definitionNames } from '../definition-names/definition-names-table.ts';
import { stamped } from '../testing/happenings.ts';
import { aStore, type LedgerEntry } from '../testing/ledger-entry.ts';

const aCreation = { type: 'definition_created', data: { name: 'reviews' } };

const created = [aCreation];

const firstOfBeta = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71/';

const secondOfAlpha = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72/';

const holdingNoName = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73/';

function placed(entry: LedgerEntry, database: string, definitionKey: string, playbookKey: string): Promise<unknown> {
  return entry.executedOn(database, (execute) =>
    execute.command(
      SQL`INSERT INTO ${definitionNames} (playbook_key, definition_type, name, definition_key, status, has_triggers)
        VALUES (${playbookKey}, 'reasoning', ${definitionKey}, ${definitionKey}, 'active', FALSE)`,
    ),
  );
}

export function definitionStreamsBehaviour(entry: LedgerEntry): void {
  describe('the definition streams of a type', () => {
    it("are the streams of that type of definition in every playbook, the playbook's own page among them, each with its version, read through an index of their own", async () => {
      const database = await entry.aDatabase();
      const store = entry.storeOn(database);
      onTestFinished(() => store.close());
      await store.migrate();
      await store.append('playbook/acme/alpha/definitions/page', [...created, ...created], {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/beta/definitions/page', created, { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/alpha/definitions/reasoning', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/alpha/runs/run-1', created, { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/gamma/notes/definitions/page', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('playbook/acme/gamma/definitions/page/nested', created, {
        expectedVersion: 0,
        context: stamped,
      });
      await store.append('org/acme/definitions', created, { expectedVersion: 0, context: stamped });
      await store.append(
        'playbook/acme/alpha/definitions/playbook',
        [{ type: 'playbook_page_saved', data: { page: null } }],
        {
          expectedVersion: 0,
          context: stamped,
        },
      );

      expect(await store.definitionStreams('page')).toEqual([
        { stream: 'playbook/acme/alpha/definitions/page', version: 2, playbookKey: 'playbook/acme/alpha/' },
        { stream: 'playbook/acme/beta/definitions/page', version: 1, playbookKey: 'playbook/acme/beta/' },
      ]);
      expect(await store.definitionStreams('computation')).toEqual([]);
      expect(await store.definitionStreams('playbook')).toEqual([
        { stream: 'playbook/acme/alpha/definitions/playbook', version: 1, playbookKey: 'playbook/acme/alpha/' },
      ]);
      expect(await entry.definitionStreamsIndexed(database)).toBe(true);
    });

    placedDefinitionStreamsBehaviour(entry);
  });
}

const streamsOfSeveralOrgs: readonly (readonly [string, number])[] = [
  ['org/beta/connections', 1],
  ['org/acme/connections', 2],
  ['org/acme/tallies', 1],
  ['org/gamma/connections/c1', 1],
  ['playbook/delta/alpha/connections', 1],
  ['playbook/epsilon/alpha/runs/run-1', 1],
  ['definition/zeta/d1/connections', 1],
];

export function orgStreamsBehaviour(entry: LedgerEntry): void {
  describe("the orgs' streams of a name", () => {
    it("are each org's own stream of that name with its version, ordered by the org", async () => {
      const store = await aStore(entry);
      await Promise.all(
        streamsOfSeveralOrgs.map(([stream, facts]) =>
          store.append(
            stream,
            Array.from({ length: facts }, () => aCreation),
            {
              expectedVersion: 0,
              context: stamped,
            },
          ),
        ),
      );

      expect(await store.orgStreams('connections')).toEqual([
        { org: 'acme', version: 2 },
        { org: 'beta', version: 1 },
      ]);
      expect(await store.orgStreams('tallies')).toEqual([{ org: 'acme', version: 1 }]);
      expect(await store.orgStreams('comments')).toEqual([]);
    });
  });
}

function placedDefinitionStreamsBehaviour(entry: LedgerEntry): void {
  it('are, under keys that name definitions, the streams of the definitions that hold a name, each with the playbook it is in', async () => {
    const database = await entry.aDatabase();
    const store = entry.storeOn(database);
    onTestFinished(() => store.close());
    await store.migrate();
    await placed(entry, database, firstOfBeta, 'playbook/acme/beta/');
    await placed(entry, database, secondOfAlpha, 'playbook/acme/alpha/');
    await Promise.all(
      [
        `${firstOfBeta}definitions/reasoning`,
        `${secondOfAlpha}definitions/reasoning`,
        `${holdingNoName}definitions/reasoning`,
        'org/acme/notes/definitions/reasoning',
      ].map((stream) => store.append(stream, created, { expectedVersion: 0, context: stamped })),
    );
    await store.append('playbook/acme/alpha/definitions/reasoning', [...created, ...created], {
      expectedVersion: 0,
      context: stamped,
    });

    expect(await store.definitionStreams('reasoning')).toEqual([
      { stream: `${firstOfBeta}definitions/reasoning`, version: 1, playbookKey: 'playbook/acme/beta/' },
      { stream: `${secondOfAlpha}definitions/reasoning`, version: 1, playbookKey: 'playbook/acme/alpha/' },
      { stream: 'playbook/acme/alpha/definitions/reasoning', version: 2, playbookKey: 'playbook/acme/alpha/' },
    ]);
  });
}
