import { Conflict } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderOf } from '../event-appender.ts';
import type { LedgerStore } from '../event-store.ts';
import { streamPortsOf } from '../ledger-service.ts';
import { happenings, noted, stamped } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import type { DefinitionNames } from './definition-names.ts';

export interface DefinitionNamesEntry extends LedgerEntry {
  readonly storeKeepingNames: (database: string, names: DefinitionNames) => LedgerStore;
}

const Named = Schema.Struct({ detail: Schema.Struct({ name: Schema.String }) });

const names: DefinitionNames = {
  types: ['named'],
  definitionKeyOf: ({ stream }) => `${stream.split('/').slice(0, 3).join('/')}/`,
  nameAfter: (_held, { data }) => ({
    playbookKey: 'playbook/acme/alpha/',
    definitionType: 'reasoning',
    name: Schema.decodeUnknownSync(Named)(data).detail.name,
    status: 'active',
    hasTriggers: false,
  }),
  takenBy: (claimed) => new Conflict({ detail: `${claimed.name} is held by another definition`, kind: 'taken' }),
};

const triage = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/definitions';

const summary = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/definitions';

async function opened(store: LedgerStore): Promise<LedgerStore> {
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

function claimedOn(store: LedgerStore, stream: string): Promise<unknown> {
  return Effect.runPromise(streamPortsOf(store).execute(stream, happenings, [noted('named', { name: 'triage' })]));
}

export function storeOnlyNamesBehaviour(entry: DefinitionNamesEntry): void {
  describe('the names of definitions, as only a store keeps them', () => {
    it('takes a refusal met by an append outside a decision, which has no one to answer, as a defect', async () => {
      const store = await opened(entry.storeKeepingNames(await entry.aDatabase(), names));
      await claimedOn(store, triage);

      const defect = await Effect.runPromise(
        eventAppenderOf(store, happenings.eventSchema)(summary, [noted('named', { name: 'triage' })], {
          expectedVersion: 0,
          context: stamped,
        }).pipe(
          Effect.as(null),
          Effect.catchDefect((thrown) => Effect.succeed(thrown)),
        ),
      );

      expect(defect).toEqual(new Conflict({ detail: 'triage is held by another definition', kind: 'taken' }));
    });

    it('are an empty table in a ledger told of none, which an append of any fact leaves empty', async () => {
      const database = await entry.aDatabase();
      const store = await opened(entry.storeOn(database));

      await claimedOn(store, triage);

      expect(await entry.queried(database, 'SELECT * FROM definition_names_1')).toEqual([]);
    });
  });
}
