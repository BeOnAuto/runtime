import { Conflict, type ProjectedMessage } from '@on.auto/operations';
import { Cause, Effect, Exit, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderOf } from '../event-appender.ts';
import type { LedgerStore } from '../event-store.ts';
import { streamPortsOf } from '../ledger-service.ts';
import { happenings, noted, stamped, type Happened } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import type { VersionConflict } from '../version-conflict.ts';
import type { DefinitionName, DefinitionNames } from './definition-names.ts';

export interface DefinitionNamesEntry extends LedgerEntry {
  readonly storeKeepingNames: (database: string, names: DefinitionNames) => LedgerStore;
}

const Named = Schema.Struct({
  detail: Schema.Struct({
    playbook: Schema.String,
    type: Schema.String,
    name: Schema.String,
    starts: Schema.Boolean,
  }),
});

const Renamed = Schema.Struct({ detail: Schema.Struct({ name: Schema.String }) });

function claimOf({ type, data }: ProjectedMessage, held: DefinitionName | undefined): DefinitionName | undefined {
  if (type === 'named') {
    const { playbook, type: definitionType, name, starts } = Schema.decodeUnknownSync(Named)(data).detail;
    return { playbookKey: `playbook/acme/${playbook}/`, definitionType, name, status: 'active', hasTriggers: starts };
  }
  if (held === undefined) {
    return undefined;
  }
  if (type === 'renamed') {
    return { ...held, name: Schema.decodeUnknownSync(Renamed)(data).detail.name };
  }
  return type === 'set_aside' ? { ...held, status: 'retired' } : undefined;
}

const takenWords = 'is held by another definition';

const names: DefinitionNames = {
  types: ['named', 'renamed', 'set_aside', 'noted'],
  nameAfter: (held, message) => claimOf(message, held),
  takenBy: (claimed, holder) =>
    new Conflict({ detail: `${claimed.name} ${takenWords} (${holder.status})`, kind: 'taken' }),
};

function named(playbook: string, type: string, name: string, starts = false): Happened {
  return noted('named', { playbook, type, name, starts });
}

const triage = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/definitions';

const summary = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/definitions';

const review = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c/definitions';

interface KeptNames {
  readonly store: LedgerStore;
  readonly database: string;
}

async function keepingNames(entry: DefinitionNamesEntry): Promise<KeptNames> {
  const database = await entry.aDatabase();
  const store = entry.storeKeepingNames(database, names);
  onTestFinished(() => store.close());
  await store.migrate();
  return { store, database };
}

async function refusedOf(store: LedgerStore, stream: string, ...happened: readonly Happened[]): Promise<unknown> {
  const exit = await Effect.runPromiseExit(streamPortsOf(store).execute(stream, happenings, happened));
  return Exit.isFailure(exit) && Cause.hasFails(exit.cause) ? Cause.squash(exit.cause) : null;
}

function defectOf(appended: Effect.Effect<void, VersionConflict>): Promise<unknown> {
  return Effect.runPromise(
    appended.pipe(
      Effect.as(null),
      Effect.catchDefect((defect) => Effect.succeed(defect)),
    ),
  );
}

const NameRows = Schema.Array(
  Schema.Struct({
    playbook_key: Schema.String,
    definition_type: Schema.String,
    name: Schema.String,
    definition_key: Schema.String,
    status: Schema.String,
    has_triggers: Schema.Union([Schema.Boolean, Schema.Number]),
  }),
);

function startsOn(hasTriggers: boolean | number): string {
  return hasTriggers === true || hasTriggers === 1 ? ' starting' : '';
}

async function namesIn(entry: DefinitionNamesEntry, database: string): Promise<readonly string[]> {
  const rows = Schema.decodeUnknownSync(NameRows)(
    await entry.queried(database, 'SELECT * FROM definition_names_1 ORDER BY definition_key'),
  );
  return rows.map(
    (row) =>
      `${row.definition_key} ${row.playbook_key}${row.definition_type}/${row.name} ${row.status}${startsOn(row.has_triggers)}`,
  );
}

function takenAs(name: string, status: string): Conflict {
  return new Conflict({ detail: `${name} ${takenWords} (${status})`, kind: 'taken' });
}

function claimedOnce(entry: DefinitionNamesEntry): void {
  describe('the names of definitions, kept in the append that claims one', () => {
    it("keeps the name each definition's key claims, and refuses the name another key holds as the conflict the command answers, keeping nothing of the append", async () => {
      const { store, database } = await keepingNames(entry);
      await refusedOf(store, triage, named('alpha', 'reasoning', 'triage', true));

      const refused = await refusedOf(store, summary, named('alpha', 'reasoning', 'triage'), noted('noted'));

      expect(refused).toEqual(takenAs('triage', 'active'));
      expect((await store.read(summary)).version).toBe(0);
      expect(await namesIn(entry, database)).toEqual([
        'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/ playbook/acme/alpha/reasoning/triage active starting',
      ]);
    });

    it('holds a name unique among the definitions of its type in its playbook alone', async () => {
      const { store, database } = await keepingNames(entry);
      await refusedOf(store, triage, named('alpha', 'reasoning', 'triage'));

      const ofAnotherType = await refusedOf(store, summary, named('alpha', 'workflow', 'triage'));
      const inAnotherPlaybook = await refusedOf(store, review, named('beta', 'reasoning', 'triage'));

      expect([ofAnotherType, inAnotherPlaybook]).toEqual([null, null]);
      expect(await namesIn(entry, database)).toEqual([
        'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/ playbook/acme/alpha/reasoning/triage active',
        'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/ playbook/acme/alpha/workflow/triage active',
        'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c/ playbook/acme/beta/reasoning/triage active',
      ]);
    });
  });
}

function nameChanges(entry: DefinitionNamesEntry): void {
  describe('a change of the name a definition holds', () => {
    it('frees the name it held the moment it claims another, and keeps a retired one under its name', async () => {
      const { store, database } = await keepingNames(entry);
      await refusedOf(store, triage, named('alpha', 'reasoning', 'triage'));
      await refusedOf(store, summary, named('alpha', 'reasoning', 'summary'));

      await refusedOf(store, triage, noted('renamed', { name: 'first-look' }));
      const theFreedName = await refusedOf(store, review, named('alpha', 'reasoning', 'triage'));
      await refusedOf(store, summary, noted('set_aside'));
      const theRetiredName = await refusedOf(store, triage, noted('renamed', { name: 'summary' }));
      await refusedOf(store, review, noted('noted'));

      expect([theFreedName, theRetiredName]).toEqual([null, takenAs('summary', 'retired')]);
      expect(await namesIn(entry, database)).toEqual([
        'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/ playbook/acme/alpha/reasoning/first-look active',
        'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/ playbook/acme/alpha/reasoning/summary retired',
        'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c/ playbook/acme/alpha/reasoning/triage active',
      ]);
    });
  });
}

function claimsAtOnce(entry: DefinitionNamesEntry): void {
  describe('two claims made at once on one name', () => {
    it('answer one and refuse the other as taken, never as a change made meanwhile', async () => {
      const { store, database } = await keepingNames(entry);

      const outcomes = await Promise.all([
        refusedOf(store, triage, named('alpha', 'reasoning', 'triage')),
        refusedOf(store, summary, named('alpha', 'reasoning', 'triage')),
      ]);

      expect(outcomes.filter((outcome) => outcome !== null)).toEqual([takenAs('triage', 'active')]);
      expect(await namesIn(entry, database)).toHaveLength(1);
    });

    it('takes a refusal met by an append outside a decision, which has no one to answer, as a defect', async () => {
      const { store } = await keepingNames(entry);
      await refusedOf(store, triage, named('alpha', 'reasoning', 'triage'));

      const defect = await defectOf(
        eventAppenderOf(store, happenings.eventSchema)(summary, [named('alpha', 'reasoning', 'triage')], {
          expectedVersion: 0,
          context: stamped,
        }),
      );

      expect(defect).toEqual(takenAs('triage', 'active'));
    });
  });
}

function namedNowhere(entry: DefinitionNamesEntry): void {
  describe('a fact that claims no name', () => {
    it('keeps none, whether its stream has no key or its definition holds no name to change', async () => {
      const { store, database } = await keepingNames(entry);

      const outcomes = [
        await refusedOf(store, 'org/acme/names', named('alpha', 'reasoning', 'triage')),
        await refusedOf(store, triage, noted('renamed', { name: 'first-look' })),
      ];

      expect(outcomes).toEqual([null, null]);
      expect(await namesIn(entry, database)).toEqual([]);
    });
  });
}

function keptEmpty(entry: DefinitionNamesEntry): void {
  describe('the names of definitions of a ledger told of none', () => {
    it('are an empty table, which an append of any fact leaves empty', async () => {
      const database = await entry.aDatabase();
      const store = entry.storeOn(database);
      onTestFinished(() => store.close());
      await store.migrate();

      await refusedOf(store, triage, named('alpha', 'reasoning', 'triage'));

      expect(await namesIn(entry, database)).toEqual([]);
    });
  });
}

export function definitionNamesBehaviour(entry: DefinitionNamesEntry): void {
  claimedOnce(entry);
  nameChanges(entry);
  claimsAtOnce(entry);
  namedNowhere(entry);
  keptEmpty(entry);
}
