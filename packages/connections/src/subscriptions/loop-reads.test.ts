import { memoryLedger } from '@on.auto/operations/testing';
import { readOfATrigger, type ConnectionTrigger } from '@on.auto/providers';
import { ofEachSubscription, providersOf, tracker } from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { addedFact, registryOf } from '../testing/loop-registries.ts';
import { subscriptionLoopPortsOf, type SubscriptionLoopParts } from './loop-ports.ts';
import { readsAskerOf } from './loop-reads.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const opened = 'com.example.ticket.opened';

const providers = providersOf({
  ...tracker,
  events: {
    types: [{ type: opened, title: 'A ticket is opened', subject: { title: 'Board', required: true }, data: {} }],
    destinations: [
      {
        ...ofEachSubscription,
        events: [
          {
            type: opened,
            when: { '$request.body#/kind': ['opened'] },
            id: ['$request.body#/id'],
            topic: '{{ subject }}',
          },
        ],
      },
    ],
  },
});

const listingNotes = {
  tool: 'list_notes',
  with: { after: '{{ since }}' },
  list: '/notes',
  order: 'oldest_first',
  id: ['/id'],
} as const;

const listingPinned = { ...listingNotes, with: { after: '{{ since }}', pinned: true } };

function aRegistry() {
  return registryOf([
    '2026-11-17T07:00:00.000Z',
    [
      addedFact('connection-1', 'tracker', 'tracker'),
      addedFact('connection-2', 'notes', null),
      addedFact('connection-3', 'sales-notes', null, { playbooks: ['sales'] }),
    ],
  ]);
}

async function askedFor(...triggers: readonly ConnectionTrigger[]) {
  const counted = { reads: 0 };
  const asker = readsAskerOf({ registry: await aRegistry(), providers }, () =>
    Effect.sync(() => {
      counted.reads += 1;
      return triggers;
    }),
  );
  return { asked: await Effect.runPromise(asker({ ...alpha, arranged: new Map() })), counted };
}

describe('the subscriptions the reads triggers name ask the loop for', () => {
  it('are one for each trigger with a read, its topic and its destination the read’s own, through a connection that serves the playbook and whose entry declares no events', async () => {
    const { asked } = await askedFor(
      { connection: 'notes', type: 'note.added', read: listingNotes },
      { connection: 'tracker', type: 'note.added', read: listingNotes },
      { connection: 'sales-notes', type: 'note.added', read: listingNotes },
      { connection: 'tracker', type: opened, subject: 'board-7' },
    );

    expect(asked).toEqual([{ connection: 'notes', ...readOfATrigger('note.added', listingNotes) }]);
  });

  it('share one topic for two triggers with the same read, and have another for another argument', async () => {
    const { asked } = await askedFor(
      { connection: 'notes', type: 'note.added', read: listingNotes },
      { connection: 'notes', type: 'note.added', read: listingNotes },
      { connection: 'notes', type: 'note.added', read: listingPinned },
    );

    const [first, again, pinned] = asked.map(({ topic }) => topic);
    expect([first === again, first === pinned]).toEqual([true, false]);
  });

  it('are none, and no connection read, where no trigger names a read', async () => {
    const { asked, counted } = await askedFor({ connection: 'tracker', type: opened });

    expect([asked, counted.reads]).toEqual([[], 1]);
  });
});

const noCalls: SubscriptionLoopParts['tools'] = {
  callOnce: () => Effect.die('a call was sent'),
  requestOnce: () => Effect.die('a request was sent'),
  mostRequestBytesTo: () => 1_048_576,
};

const noSecrets = {
  keep: () => Effect.die('a secret was kept'),
  read: () => Effect.die('a secret was read'),
  forget: () => Effect.die('a secret was forgotten'),
};

function askedBy(ports: ReturnType<typeof subscriptionLoopPortsOf>) {
  return Effect.runPromise(Effect.forEach(ports.askers, (asker) => asker({ ...alpha, arranged: new Map() })));
}

describe('the ports of the loop', () => {
  it('ask for the reads triggers name only on a runtime that takes in what a check finds', async () => {
    const triggers = [{ connection: 'notes', type: 'note.added', read: listingNotes }];
    const ledger = memoryLedger().service;
    const parts: SubscriptionLoopParts = {
      ledger,
      registry: await aRegistry(),
      waitingIn: () => Effect.succeed([]),
      triggersIn: () => Effect.succeed(triggers),
      tools: noCalls,
      secrets: noSecrets,
      providers,
      receivesOverHttp: true,
    };

    const withoutATakeIn = await askedBy(subscriptionLoopPortsOf(parts));
    const takingIn = await askedBy(subscriptionLoopPortsOf({ ...parts, takeIn: () => Effect.succeed('taken') }));

    expect([withoutATakeIn.flat(), takingIn.flat().map(({ connection }) => connection)]).toEqual([[], ['notes']]);
  });
});
