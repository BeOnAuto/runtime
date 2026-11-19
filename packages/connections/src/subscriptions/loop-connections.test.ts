import type { Decided, PlaybookAddress } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { ofEachSubscription, providersOf, tracker } from '@on.auto/providers/testing';
import { Effect, Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEventSchema, type RecordedConnectionEvent } from '../registry/connection-events.ts';
import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { loopConnectionsOf } from './loop-connections.ts';
import { subscriptionLoopPortsOf, type SubscriptionLoopParts } from './loop-ports.ts';
import { deliveryDestinationOf } from './subscription-deliveries.ts';

const theSecret = {
  kind: 'secret',
  name: 'Authorization',
  in: 'header',
  instructions: 'Make a key under Settings.',
  key_page: 'https://keys.example.com/settings/keys',
} as const;

function addedFact(connection: string, name: string, provider: string | null, playbooks?: readonly string[]) {
  const entry = { url: `https://${name}.example.com/mcp` };
  return {
    type: 'connection_added',
    data: {
      connection,
      name,
      server_type: 'mcp',
      provider,
      placeholders: null,
      entry: playbooks === undefined ? entry : { ...entry, playbooks },
      credential: theSecret,
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
  } as const;
}

const connectedAt = '2026-11-17T08:00:00.000Z';

const added = [
  addedFact('connection-1', 'tracker', 'tracker'),
  addedFact('connection-2', 'notes', null),
  addedFact('connection-3', 'sales-only', null, ['sales']),
  addedFact('connection-4', 'gone', null),
  { type: 'connection_removed', data: { connection: 'connection-4' } },
] as const;

const connected = [
  {
    type: 'connection_connected',
    data: { connection: 'connection-1', secret_id: 'secret-9', connected_by: { id: 'person:ada', name: 'Ada' } },
  },
] as const;

function recordedAt(at: string) {
  return {
    initialState: null,
    evolve: () => null,
    eventSchema: ConnectionEventSchema,
    decide: (facts: readonly Decided<RecordedConnectionEvent>[]) => Result.succeed(facts),
    context: () => ({ at, by: 'person:ada' }),
  };
}

const providers = providersOf({ ...tracker, events: { destinations: [ofEachSubscription] } });

const declared = providers.providers.flatMap(({ entry }) => entry.events?.destinations ?? []);

async function aRegistry() {
  const registry = memoryLedger().service;
  const stream = connectionsStreamOfOrg('acme');
  await Effect.runPromise(registry.execute(stream, recordedAt('2026-11-17T07:00:00.000Z'), added));
  await Effect.runPromise(registry.execute(stream, recordedAt(connectedAt), connected));
  return registry;
}

async function connectionsOver() {
  const connectionsOf = loopConnectionsOf({ registry: await aRegistry(), providers });
  return (org: string, playbook: string) => Effect.runPromise(connectionsOf({ org, playbook }));
}

describe('the connections the loop arranges through', () => {
  it('are those of the org not removed that serve the playbook, with when each was connected and what its entry declares', async () => {
    const connectionsOf = await connectionsOver();

    expect(await connectionsOf('acme', 'alpha')).toEqual([
      { connection: 'tracker', connected: connectedAt, destinations: declared },
      { connection: 'notes', destinations: [] },
    ]);
  });

  it('take in a connection that serves only some playbooks for those alone, and none of another org', async () => {
    const connectionsOf = await connectionsOver();
    const names = async (org: string, playbook: string) =>
      (await connectionsOf(org, playbook)).map(({ connection }) => connection);

    expect(await names('acme', 'sales')).toEqual(['tracker', 'notes', 'sales-only']);
    expect(await names('globex', 'alpha')).toEqual([]);
  });
});

const ofTheApp = {
  type: 'webhook',
  per: 'app',
  verify: { scheme: 'bearer', secret: 'app', token: '$request.header.X-Rooms-Token' },
  filter: { when: { '$request.header.X-Rooms-Event': ['message'] }, conversation: '$request.body#/room' },
  connection: { account: '$request.body#/workspace' },
};

const withAnAppsEntry = providersOf(
  { ...tracker, events: { destinations: [ofEachSubscription] } },
  { ...tracker, name: 'rooms', title: 'Rooms', events: { destinations: [ofTheApp] } },
);

const addedBeside = [
  addedFact('connection-5', 'rooms', 'rooms'),
  addedFact('connection-6', 'sales-tracker', 'tracker', ['sales']),
  addedFact('connection-7', 'gone-tracker', 'tracker'),
  { type: 'connection_removed', data: { connection: 'connection-7' } },
] as const;

async function destinationsOver() {
  const ledger = memoryLedger().service;
  await Effect.runPromise(
    ledger.execute(connectionsStreamOfOrg('acme'), recordedAt('2026-11-17T07:00:00.000Z'), [...added, ...addedBeside]),
  );
  const destinationOf = deliveryDestinationOf({ registry: ledger, providers: withAnAppsEntry });
  return (org: string, playbook: string, connection: string) =>
    Effect.runPromise(destinationOf({ org, playbook, connection }));
}

describe('the destination a delivery to a connection’s events address is proven against', () => {
  it('is the webhook per subscription its entry declares, for a connection the loop arranges through', async () => {
    const destinationOf = await destinationsOver();

    expect([
      await destinationOf('acme', 'alpha', 'tracker'),
      await destinationOf('acme', 'sales', 'sales-tracker'),
    ]).toEqual([declared[0], declared[0]]);
  });

  it('is none for an entry of no webhook per subscription, a connection given by hand, removed, of another playbook or org, or unknown', async () => {
    const destinationOf = await destinationsOver();

    expect(
      await Promise.all([
        destinationOf('acme', 'alpha', 'rooms'),
        destinationOf('acme', 'alpha', 'notes'),
        destinationOf('acme', 'alpha', 'gone-tracker'),
        destinationOf('acme', 'alpha', 'sales-tracker'),
        destinationOf('globex', 'alpha', 'tracker'),
        destinationOf('acme', 'alpha', 'billing'),
      ]),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

const alpha = { org: 'acme', playbook: 'alpha' };

const place = { ...alpha, connection: 'tracker' };

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

function partsOver(
  waitingIn: SubscriptionLoopParts['waitingIn'] = () => Effect.die('a request was read'),
): SubscriptionLoopParts {
  const ledger = memoryLedger().service;
  return { ledger, registry: ledger, waitingIn, tools: noCalls, secrets: noSecrets, providers, receivesOverHttp: true };
}

function eventsAddressOf({ connection }: { readonly connection: string }): string {
  return `https://runtime.example.com/${connection}`;
}

describe('the address the ports of the loop name', () => {
  it('is none where none is given, and the runtime receives a webhook over HTTP alone, as it does', () => {
    const ports = subscriptionLoopPortsOf(partsOver());

    expect([ports.callbackOf(place, 'webhook'), ports.callbackOf(place, 'queue')]).toEqual([undefined, undefined]);
    expect([ports.receives('webhook'), ports.receives('websocket'), ports.receives('queue')]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('is the address given, for a webhook while the runtime receives over HTTP, and none for a queue', () => {
    const receiving = subscriptionLoopPortsOf({ ...partsOver(), eventsAddressOf });

    expect([receiving.callbackOf(place, 'webhook'), receiving.callbackOf(place, 'queue')]).toEqual([
      'https://runtime.example.com/tracker',
      undefined,
    ]);
  });

  it('is none while the runtime receives nothing over HTTP', () => {
    const closed = subscriptionLoopPortsOf({ ...partsOver(), eventsAddressOf, receivesOverHttp: false });

    expect([closed.callbackOf(place, 'webhook'), closed.receives('webhook')]).toEqual([undefined, false]);
  });
});

const waiting = [{ connection: 'tracker', with: { project: 'site' }, sent: { conversation: 'C0123', id: '1699.1' } }];

describe('the ports of the loop', () => {
  it('read the connections of the playbook from the registry given, and the requests from the reader given', async () => {
    const read: PlaybookAddress[] = [];
    const reading = (playbook: PlaybookAddress) =>
      Effect.sync(() => {
        read.push(playbook);
        return waiting;
      });
    const ports = subscriptionLoopPortsOf({ ...partsOver(reading), registry: await aRegistry() });
    const [asker] = ports.askers;
    const arranged = new Map(declared.map((each) => ['tracker', each]));

    expect((await Effect.runPromise(ports.connectionsOf(alpha))).map(({ connection }) => connection)).toEqual([
      'tracker',
      'notes',
    ]);
    expect(await Effect.runPromise(Option.getOrThrow(Option.fromNullishOr(asker))({ ...alpha, arranged }))).toEqual([
      { connection: 'tracker', topic: 'site' },
    ]);
    expect(read).toEqual([alpha]);
  });

  it('hold at most 8 subscriptions through a connection', () => {
    expect(subscriptionLoopPortsOf(partsOver()).mostPerConnection).toBe(8);
  });
});
