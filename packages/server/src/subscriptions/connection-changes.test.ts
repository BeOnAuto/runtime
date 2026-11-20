import { connectionsStreamOfOrg, eventSubscriptions, subscriptionRecordsOf } from '@on.auto/connections';
import { streamSignalOf } from '@on.auto/ledger';
import type { Ledger, PlaybookAddress } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  connectedOf,
  connectionsRecorded,
  playbooksCreated,
  registryListedIn,
  type ConnectionFact,
} from '../testing/subscriptions/connections-followed.ts';
import { connectionChangesWakeUpOf } from './connection-changes.ts';

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
