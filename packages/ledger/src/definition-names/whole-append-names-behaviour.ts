import { Conflict } from '@on.auto/operations';
import type { HeldName } from '@on.auto/operations/definition-names';
import { namesAtThePortBehaviour, type NamesAtThePort } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { EncodedEvent, LedgerStore } from '../event-store.ts';
import { streamPortsOf } from '../ledger-service.ts';
import { to } from '../multi-stream/multi-stream-cases.ts';
import { storeOnlyNamesBehaviour, type DefinitionNamesEntry } from './definition-names-behaviour.ts';
import type { DefinitionNames } from './definition-names.ts';

const Claimed = Schema.Struct({ name: Schema.String, starts: Schema.Boolean });

const claimedIn = Schema.decodeUnknownSync(Claimed);

const counted: DefinitionNames = {
  types: ['claimed'],
  definitionKeyOf: ({ stream }) => `${stream.split('/').slice(0, 3).join('/')}/`,
  nameAfter: (_held, { data }) => {
    const { name, starts } = claimedIn(data);
    return {
      playbookKey: 'playbook/acme/alpha/',
      definitionType: 'reasoning',
      name,
      status: 'active',
      hasTriggers: starts,
    };
  },
  takenBy: (claimed) => new Conflict({ detail: `${claimed.name} is held`, kind: 'taken' }),
  bounds: [
    {
      checkedBy: ['claimed'],
      counts: () => true,
      most: () => 2,
      beyond: (claimed, type, before, most) =>
        new Conflict({ detail: `${claimed.name} ${type}: ${before} of ${most}` }),
    },
  ],
};

function streamOf(letter: string): string {
  return `definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7${letter}/definitions`;
}

function claim(name: string): EncodedEvent {
  return { type: 'claimed', data: { name, starts: false } };
}

async function storeOf(entry: DefinitionNamesEntry, names: DefinitionNames): Promise<LedgerStore> {
  const store = entry.storeKeepingNames(await entry.aDatabase(), names);
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

const HeldRows = Schema.Array(
  Schema.Struct({
    playbook_key: Schema.String,
    definition_type: Schema.String,
    name: Schema.String,
    definition_key: Schema.String,
    status: Schema.String,
    has_triggers: Schema.Union([Schema.Boolean, Schema.Literals([0, 1])]),
  }),
);

async function heldIn(entry: DefinitionNamesEntry, database: string): Promise<readonly HeldName[]> {
  const rows = Schema.decodeUnknownSync(HeldRows)(
    await entry.queried(database, 'SELECT * FROM definition_names_1 ORDER BY definition_key'),
  );
  return rows.map((row) => ({
    playbookKey: row.playbook_key,
    definitionType: row.definition_type,
    name: row.name,
    definitionKey: row.definition_key,
    status: row.status,
    hasTriggers: row.has_triggers === true || row.has_triggers === 1,
  }));
}

function atThePort(entry: DefinitionNamesEntry): (names: DefinitionNames) => Promise<NamesAtThePort> {
  return async (names) => {
    const database = await entry.aDatabase();
    const store = entry.storeKeepingNames(database, names);
    onTestFinished(() => store.close());
    await store.migrate();
    return { ledger: streamPortsOf(store), names: () => heldIn(entry, database) };
  };
}

function severalStreams(entry: DefinitionNamesEntry): void {
  describe('the names of an append to several streams', () => {
    it('frees a name one definition gives up for another that claims it in the same append, whatever the order of their streams', async () => {
      const store = await storeOf(entry, counted);
      await store.multiStreamAppend([to(streamOf('a'), 0, claim('triage')), to(streamOf('b'), 0, claim('brief'))]);

      await store.multiStreamAppend([to(streamOf('b'), 1, claim('triage')), to(streamOf('a'), 1, claim('brief'))]);

      const taken = await store
        .multiStreamAppend([to(streamOf('c'), 0, claim('triage'))])
        .catch((refusal: unknown) => refusal);

      expect([(await store.read(streamOf('a'))).version, (await store.read(streamOf('b'))).version]).toEqual([2, 2]);
      expect(taken).toMatchObject({ detail: 'triage is held', stream: streamOf('c') });
    });

    it('refuses an append beyond a bound naming the stream of the fact it refuses, and keeps nothing of any stream', async () => {
      const store = await storeOf(entry, counted);
      await store.multiStreamAppend([to(streamOf('a'), 0, claim('triage')), to(streamOf('b'), 0, claim('brief'))]);

      const refused = await store
        .multiStreamAppend([to(streamOf('c'), 0, claim('review')), to(streamOf('d'), 0, claim('notes'))])
        .catch((refusal: unknown) => refusal);

      expect(refused).toMatchObject({ detail: 'review claimed: 2 of 2', stream: streamOf('c') });
      expect([(await store.read(streamOf('c'))).version, (await store.read(streamOf('d'))).version]).toEqual([0, 0]);
    });
  });
}

export function definitionNamesBehaviour(entry: DefinitionNamesEntry): void {
  namesAtThePortBehaviour({ keeping: atThePort(entry) });
  storeOnlyNamesBehaviour(entry);
  severalStreams(entry);
}
