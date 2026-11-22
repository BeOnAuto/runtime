import { connectionsStreamOfOrg, eventSubscriptions, subscriptionRecordsOf } from '@on.auto/connections';
import { decidedIn, definitionNamesWith, definitionsReadModelOf } from '@on.auto/definitions/testing';
import { openRequests, openRequestsName } from '@on.auto/interaction';
import { streamSignalOf } from '@on.auto/ledger';
import type { Ledger, PlaybookAddress } from '@on.auto/operations';
import { memoryLedger, memoryLedgerWith } from '@on.auto/operations/testing';
import { Effect, Function, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  connectedOf,
  connectionsRecorded,
  playbooksCreated,
  registryListedIn,
  type ConnectionFact,
} from '../testing/subscriptions/connections-followed.ts';
import { connectionChangesWakeUpOf, connectionChangesWakeUpsOf } from './connection-changes.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const removed: ConnectionFact = { type: 'connection_removed', data: { connection: 'connection-1' } };

function run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, Logger.layer([])));
}

async function anOrgOfTwoPlaybooks(): Promise<Ledger['Service']> {
  const ledger = memoryLedger(undefined, [eventSubscriptions]).service;
  await playbooksCreated(ledger, 'acme', ['alpha', 'beta']);
  const subscription = { type: 'webhook', id: 'subscription-1', declared: 'a'.repeat(64) } as const;
  await run(subscriptionRecordsOf(ledger).made(alpha, { connection: 'tracker', topic: 'acme/site' }, subscription));
  await connectionsRecorded(ledger, 'acme', [connectedOf('connection-1')]);
  return ledger;
}

interface Following {
  listing: 'listed' | 'unlisted' | 'failing';
  factsFail: boolean;
  unaskedOf: string;
  raised: number;
}

function ledgerFailingAt(kept: Ledger['Service'], failing: () => boolean): Ledger['Service'] {
  return {
    ...kept,
    readAppendedFacts: (scope, request) =>
      failing() ? Effect.die(new Error('the ledger is down')) : kept.readAppendedFacts(scope, request),
  };
}

function listedOver(kept: Ledger['Service'], listing: () => 'listed' | 'unlisted' | 'failing') {
  const listed = registryListedIn(kept, 'acme');
  return async () => {
    if (listing() === 'failing') throw new Error('the ledger is down');
    const orgs = await listed();
    return listing() === 'listed' ? orgs : [];
  };
}

async function followingOver() {
  const kept = await anOrgOfTwoPlaybooks();
  const state: Following = { listing: 'listed', factsFail: false, unaskedOf: '', raised: 0 };
  const asked: string[] = [];
  const appended = streamSignalOf();
  const wakeUp = connectionChangesWakeUpOf({
    ledger: ledgerFailingAt(kept, () => state.factsFail),
    streams: { orgStreams: listedOver(kept, () => state.listing) },
    appended,
    sentIn: ({ playbook }: PlaybookAddress) =>
      playbook === state.unaskedOf ? Effect.die(new Error('the playbook could not be read')) : Effect.succeed(false),
    triggersIn: () => Effect.succeed([]),
    asked: ({ playbook }) => {
      asked.push(playbook);
    },
  })({
    raised: () => {
      state.raised += 1;
    },
    renewed: () => {
      state.raised += 0;
    },
  });
  const wokenAt = async (now: number) => (await run(wakeUp.wakeUp({ now, sweep: false }))).nextDueAt;
  const changed = async (...facts: readonly ConnectionFact[]) => {
    await connectionsRecorded(kept, 'acme', facts);
    appended.raise(connectionsStreamOfOrg('acme'));
  };
  const quietly = (...facts: readonly ConnectionFact[]) => connectionsRecorded(kept, 'acme', facts);
  return { state, asked, appended, wakeUp, wokenAt, changed, quietly };
}

describe('a server that follows the connections of its orgs', () => {
  it('asks each playbook that listens through a connection once at its start, again as its connections change, heard at once or within the minute', async () => {
    const following = await followingOver();
    const due = [await following.wokenAt(0)];
    const atTheStart = [...following.asked];
    due.push(await following.wokenAt(30_000));
    await following.changed(removed);
    due.push(await following.wokenAt(30_001));
    await following.quietly(connectedOf('connection-2'));
    due.push(await following.wokenAt(60_000));
    const beforeTheMinute = [...following.asked];
    due.push(await following.wokenAt(90_001));

    expect([atTheStart, beforeTheMinute, following.asked]).toEqual([
      ['alpha'],
      ['alpha', 'alpha'],
      ['alpha', 'alpha', 'alpha'],
    ]);
    expect(due).toEqual([60_000, 60_000, 90_001, 90_001, 150_001]);
  });

  it('is woken by an append to the connections of an org alone, and by none once it stops', async () => {
    const following = await followingOver();
    following.appended.raise('playbook/acme/alpha/runs/run-1');
    following.appended.raise(connectionsStreamOfOrg('acme'));
    await run(following.wakeUp.stop());
    following.appended.raise(connectionsStreamOfOrg('acme'));

    expect(following.state.raised).toBe(1);
  });
});

describe('a server that follows the connections of its orgs, where a read fails', () => {
  it('asks again at its next round where a playbook could not be asked or the facts could not be read, and forgets an org no longer listed', async () => {
    const following = await followingOver();
    following.state.listing = 'failing';
    await following.wokenAt(0);
    following.state.listing = 'listed';
    following.state.unaskedOf = 'beta';
    await following.wokenAt(60_000);
    following.state.unaskedOf = '';
    following.state.factsFail = true;
    await following.wokenAt(120_000);
    following.state.factsFail = false;
    await following.wokenAt(180_000);
    await following.wokenAt(240_000);
    const whileListed = [...following.asked];
    following.state.listing = 'unlisted';
    await following.wokenAt(300_000);
    following.state.listing = 'listed';
    await following.wokenAt(360_000);

    expect([whileListed, following.asked]).toEqual([
      ['alpha', 'alpha'],
      ['alpha', 'alpha', 'alpha'],
    ]);
  });
});

const ada = { id: 'person:ada', name: 'Ada' };

function savedListeningIn(ledger: Ledger['Service'], playbook: PlaybookAddress) {
  const attributes = { type: 'com.example.chat.post', source: '/connections/rooms', subject: 'C1' };
  const filters = [{ reference: '/schedule/on/one', type: attributes.type, attributes }];
  return Effect.runPromise(
    decidedIn(ledger, playbook, 'workflow', {
      type: 'create',
      name: 'on-a-post',
      content: { source: 'on-a-post', triggers: [{ kind: 'event', reference: '/schedule/on', filters }] },
      created_by: ada,
      definition_id: 'on-a-post-id',
      by: ada.id,
      at: '2026-11-20T09:00:00.000Z',
    }),
  );
}

/** An org whose alpha listens in a room through a connection, whose beta holds only a request sent, and gamma neither. */
async function anOrgListening(): Promise<Ledger['Service']> {
  const kept = memoryLedgerWith({
    projections: [...definitionsReadModelOf(['workflow']), eventSubscriptions, openRequests],
    definitionNames: definitionNamesWith([]),
  }).service;
  await playbooksCreated(kept, 'acme', ['alpha', 'beta', 'gamma']);
  await savedListeningIn(kept, alpha);
  await connectionsRecorded(kept, 'acme', [connectedOf('connection-1')]);
  const sent = { key: 'request-1', org: 'acme', playbook: 'beta', row: {} };
  return {
    ...kept,
    readProjectedRows: (table, address, query) =>
      table === openRequestsName && address.playbook === 'beta'
        ? Effect.succeed([sent])
        : kept.readProjectedRows(table, address, query),
  };
}

describe('the playbooks a change of the connections asks a round of', () => {
  it.each([
    [false, ['alpha']],
    [true, ['alpha', 'beta']],
  ] as const)(
    'are, where a way is arranged is %s, those whose triggers name a connection, and those holding a request sent only where a way is arranged',
    async (arrangesAWay, askedOf) => {
      const ledger = await anOrgListening();
      const asked: string[] = [];
      const wakeUps = connectionChangesWakeUpsOf({
        ledger,
        asked: ({ playbook }) => {
          asked.push(playbook);
        },
        arrangesAWay,
      })({
        streams: { orgStreams: registryListedIn(ledger, 'acme') },
        appended: streamSignalOf(),
      });
      const signal = { raised: Function.constVoid, renewed: Function.constVoid };
      await run(Effect.forEach(wakeUps, (wakeUpWith) => wakeUpWith(signal).wakeUp({ now: 0, sweep: false })));

      expect([wakeUps.length, asked.toSorted()]).toEqual([1, askedOf]);
    },
  );
});
