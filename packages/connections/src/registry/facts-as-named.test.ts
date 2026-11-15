import { readFileSync } from 'node:fs';

import type { ProviderList } from '@on.auto/providers';
import { messagesThrough, providerListOf, providerOf } from '@on.auto/providers/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { connectionsFoldOf } from './registry-decider.ts';
import { evolveRegistry, initialRegistry, type Registry } from './registry.ts';

const factOf = Schema.decodeUnknownSync(Schema.toCodecJson(ConnectionEventSchema));

function recordedIn(release: string): RecordedConnectionEvent {
  return factOf(JSON.parse(readFileSync(new URL(`./${release}/connection_added.json`, import.meta.url), 'utf8')));
}

const recordedAdditions: readonly RecordedConnectionEvent[] = ['0.46.0', '0.49.0', '0.57.0', '0.59.0', '0.60.0'].map(
  (release) => recordedIn(release),
);

const files = {
  name: 'files',
  title: 'Files',
  description: 'Read the files of an account.',
  website: 'https://developer.files.example.com',
  type: 'mcp',
  url: 'https://mcp.files.example.com/mcp',
  credentials: [{ kind: 'none' }],
};

const notesEntry = {
  name: 'notes',
  title: 'Notes',
  description: 'Read and write the notes of a team.',
  website: 'https://developer.notes.example.com',
  type: 'openapi',
  document: 'documents/notes.openapi.json',
  credentials: [{ kind: 'none' }],
};

const notes = providerOf({ ...notesEntry, aliases: ['jottings'] }, 'https://api.notes.example.com/v1');

const jottingsAdded = factOf({
  type: 'connection_added',
  data: {
    connection: 'connection-of-jottings',
    name: 'team-notes',
    server_type: 'openapi',
    provider: 'jottings',
    placeholders: {},
    entry: { document: 'documents/jottings.openapi.json', playbooks: ['weekly'] },
    credential: { kind: 'none' },
    says: {},
    added_by: { id: 'person:ada', name: 'Ada Lovelace' },
  },
  context: { at: '2026-11-01T09:00:00.000Z', by: 'person:ada' },
});

function foldedAsRecorded(facts: readonly RecordedConnectionEvent[]): Registry {
  return facts.reduce((registry, fact) => evolveRegistry(registry, fact), initialRegistry);
}

function foldedWith(providers: ProviderList, facts: readonly RecordedConnectionEvent[]): Registry {
  const { evolve, initialState } = connectionsFoldOf(providers);
  return facts.reduce((registry, fact) => evolve(registry, fact), initialState);
}

function connectionIn(registry: Registry, id: string) {
  return registry.get(id)?.connection;
}

const histories: readonly (readonly RecordedConnectionEvent[])[] = [...recordedAdditions, jottingsAdded].map(
  (fact): readonly RecordedConnectionEvent[] => [fact],
);

describe('the connections of an org, folded where no provider declares another name', () => {
  it('are each fact as it was recorded, whatever providers the runtime has', () => {
    const lists: readonly ProviderList[] = [
      providerListOf(),
      providerListOf(
        providerOf(files),
        providerOf(messagesThrough()),
        providerOf(notesEntry, 'https://api.notes.example.com/v1'),
      ),
    ];

    expect(lists.map((providers) => histories.map((facts) => foldedWith(providers, facts)))).toEqual(
      lists.map(() => histories.map((facts) => foldedAsRecorded(facts))),
    );
  });
});

describe('a connection added under a name its provider declares as another of its names', () => {
  it('is folded under the provider’s name now, its document beside the entries the provider’s now, all else as recorded', () => {
    const asRecorded = connectionIn(foldedAsRecorded([jottingsAdded]), 'connection-of-jottings');

    expect(connectionIn(foldedWith(providerListOf(notes), [jottingsAdded]), 'connection-of-jottings')).toEqual({
      ...asRecorded,
      provider: 'notes',
      entry: { document: 'documents/notes.openapi.json', playbooks: ['weekly'] },
    });
  });

  it('keeps its own name, the server it reaches by address and an entry with no document as recorded', () => {
    const renamed = providerListOf(
      providerOf({ ...messagesThrough(), name: 'relay', aliases: ['messages'] }),
      providerOf({ ...files, name: 'drive', aliases: ['files'] }),
    );
    const ofFiles = recordedIn('0.49.0');
    const ofMessages = recordedIn('0.60.0');
    const filesNow = connectionIn(foldedWith(renamed, [ofFiles]), 'connection-1');
    const messagesNow = connectionIn(foldedWith(renamed, [ofMessages]), 'connection-1');

    expect(filesNow).toEqual({ ...connectionIn(foldedAsRecorded([ofFiles]), 'connection-1'), provider: 'drive' });
    expect(messagesNow).toEqual({ ...connectionIn(foldedAsRecorded([ofMessages]), 'connection-1'), provider: 'relay' });
    expect([filesNow?.name, filesNow?.entry, messagesNow?.name, messagesNow?.entry]).toEqual([
      'files',
      { url: 'https://mcp.files.example.com/mcp' },
      'messages',
      { document: 'https://gateway.messages.example.com/openapi.json' },
    ]);
  });
});
