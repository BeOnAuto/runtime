import type { PersonRow } from '@on.auto/openid-connect';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { chatStoreInMemory } from '../../testing/chat/chat-store-in-memory.ts';
import { shippedProviders } from '../../testing/chat/shipped-slack-bot.ts';
import { chatAtStartOf } from './chat-at-start.ts';
import { knowingOf, type ChatOpened } from './chat-knowing.ts';
import { chatComposedOf } from './chat-served.ts';
import { connectionsOverTheLedger } from './ledger-ports.ts';

const rowsOfPeople: readonly PersonRow[] = [
  { person: 'ada', name: 'Ada', joinedAt: 1, updatedAt: 1 },
  { person: 'bo', emailAddress: 'bo@example.com', joinedAt: 1, updatedAt: 1 },
];

const modelsOfNone = {
  models: Effect.die(new Error('no models')),
  modelChoice: { refusalOf: (): Effect.Effect<string | undefined> => Effect.undefined },
};

function opened(): ChatOpened {
  return {
    store: chatStoreInMemory().store,
    publicUrl: 'https://runtime.example.com',
    enrolling: { holdsARole: (person) => Promise.resolve(person === 'ada') },
    peopleRows: {
      listed: () => Promise.resolve([]),
      found: (person) => Promise.resolve(rowsOfPeople.find((row) => row.person === person)),
    },
    hashed: { of: (code) => code },
  };
}

describe('what the chat knows of people, and the chat at the start of a server', () => {
  it('names a person by their name, their address, or their id, and opens nothing on a server that signs nobody in', async () => {
    const knowing = knowingOf(opened(), () => 1);

    expect([
      await knowing.nameOf('ada'),
      await knowing.nameOf('bo'),
      await knowing.nameOf('cy'),
      await knowing.holdsARole('ada'),
      await knowing.personOfAVerifiedAddress('ada@example.com'),
    ]).toEqual(['Ada', 'bo@example.com', 'cy', true, undefined]);
  });
});

const settings = { providers: shippedProviders, studio: { origin: 'https://studio.example.com', served: false } };

describe('the chat at the start of a server that signs people in', () => {
  it('forgets what members wrote through a removed connection, logs where it cannot, and names no one before the chat is composed', async () => {
    const chat = chatAtStartOf(opened(), settings);
    const store = opened().store;
    const unforgetting = chatAtStartOf(
      {
        ...opened(),
        store: {
          ...store,
          deletions: { ...store.deletions, connectionRemoved: () => Promise.reject(new Error('no table')) },
        },
      },
      settings,
    );

    await Effect.runPromise(chat.connectionRemoved({ connection: 'connection-1', account: 'T1' }));
    await Effect.runPromise(unforgetting.connectionRemoved({ connection: 'connection-1', account: undefined }));

    expect([
      await chat.names.ofTheService('T1'),
      await chat.names.ofTheMember({ account: 'T1', member: 'U1' }),
    ]).toEqual([undefined, undefined]);
  });

  it('composes the chat over the ledger, whose names it then answers with', async () => {
    const ledger = memoryLedger().service;
    const ports = connectionsOverTheLedger(ledger, shippedProviders);
    const composed = chatComposedOf(
      {
        opened: opened(),
        ...ports,
        ...modelsOfNone,
        callAsTheConnection: () => Effect.die(new Error('unused')),
        directory: { asking: (_c, _x, use) => use(() => Promise.reject(new Error('unused'))) },
        context: undefined,
      },
      { tools: { mostRequestBytesTo: () => 0 } },
    );

    expect([
      await Effect.runPromise(ports.held('acme')),
      await Effect.runPromise(ports.playbooks('acme')),
      await composed.names.ofTheService('T1'),
    ]).toEqual([[], [], undefined]);
  });
});
