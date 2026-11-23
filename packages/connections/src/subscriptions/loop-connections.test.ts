import { subscriptionLoopOf } from '@on.auto/providers';
import {
  ofEachSubscription,
  overASocket,
  providersOf,
  throughItsTools,
  tracker,
  trackerOverASocket,
} from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptLedger } from '../testing/kept-ledger.ts';
import { addedFact, givenByHand, registryOf } from '../testing/loop-registries.ts';
import { loopConnectionsOf } from './loop-connections.ts';
import { subscriptionLoopPortsOf, type SubscriptionLoopParts } from './loop-ports.ts';
import { deliveryDestinationOf } from './subscription-deliveries.ts';
import { eventSubscriptions } from './subscription-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const connectedAt = '2026-11-17T08:00:00.000Z';

const added = [
  addedFact('connection-1', 'tracker', 'tracker'),
  addedFact('connection-2', 'notes', null),
  addedFact('connection-3', 'sales-only', null, { playbooks: ['sales'] }),
  addedFact('connection-4', 'gone', null),
  { type: 'connection_removed', data: { connection: 'connection-4' } },
] as const;

const connected = [
  {
    type: 'connection_connected',
    data: { connection: 'connection-1', secret_id: 'secret-9', connected_by: { id: 'person:ada', name: 'Ada' } },
  },
] as const;

const providers = providersOf({ ...tracker, events: { destinations: [ofEachSubscription] } });

const declared = providers.providers.flatMap(({ entry }) => entry.events?.destinations ?? []);

const addedAt = '2026-11-17T07:00:00.000Z';

function aRegistry() {
  return registryOf([addedAt, added], [connectedAt, connected]);
}

async function connectionsOver() {
  const connectionsOf = loopConnectionsOf({ registry: await aRegistry(), providers });
  return (org: string, playbook: string) => Effect.runPromise(connectionsOf({ org, playbook }));
}

describe('the connections the loop arranges through', () => {
  it('are those of the org not removed that serve the playbook, with their id, when each was connected and what its entry declares', async () => {
    const connectionsOf = await connectionsOver();

    expect(await connectionsOf('acme', 'alpha')).toEqual([
      { id: 'connection-1', connection: 'tracker', connected: connectedAt, destinations: declared },
      { id: 'connection-2', connection: 'notes', destinations: [] },
    ]);
  });

  it('keep the id of a connection connected again, with the account it was connected in, and give one added again under a removed one’s name its own', async () => {
    const inAnAccount = { ...connected[0], data: { ...connected[0].data, account: { id: 'workspace' } } };
    const again = ['2026-11-18T08:00:00.000Z', [inAnAccount, addedFact('connection-9', 'gone', null)]] as const;
    const registry = await registryOf([addedAt, added], [connectedAt, connected], again);

    expect(await Effect.runPromise(loopConnectionsOf({ registry, providers })(alpha))).toEqual([
      { id: 'connection-1', connection: 'tracker', connected: again[0], account: 'workspace', destinations: declared },
      { id: 'connection-2', connection: 'notes', destinations: [] },
      { id: 'connection-9', connection: 'gone', destinations: [] },
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
  addedFact('connection-6', 'sales-tracker', 'tracker', { playbooks: ['sales'] }),
  addedFact('connection-7', 'gone-tracker', 'tracker'),
  { type: 'connection_removed', data: { connection: 'connection-7' } },
] as const;

async function destinationsOver() {
  const registry = await registryOf([addedAt, [...added, ...addedBeside]]);
  const destinationOf = deliveryDestinationOf({ registry, providers: withAnAppsEntry });
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
  triggersIn: SubscriptionLoopParts['triggersIn'] = () => Effect.die('a trigger was read'),
): SubscriptionLoopParts {
  const ledger = keptLedger().service;
  const given = { tools: noCalls, secrets: noSecrets, providers, receivesOverHttp: true };
  return { ledger, registry: ledger, waitingIn, triggersIn, ...given };
}

function eventsAddressOf({ connection }: { readonly connection: string }): string {
  return `https://runtime.example.com/${connection}`;
}

describe('the address the ports of the loop name', () => {
  it('is none where none is given, and the runtime receives a webhook over HTTP alone, as it does', () => {
    const { callbackOf, receives } = subscriptionLoopPortsOf(partsOver());

    expect([callbackOf(place, 'webhook'), callbackOf(place, 'queue')]).toEqual([undefined, undefined]);
    expect([receives('webhook'), receives('websocket'), receives('queue')]).toEqual([true, false, false]);
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

  it('takes a socket in place of a subscription where this runtime opens sockets', () => {
    const opening = subscriptionLoopPortsOf({ ...partsOver(), eventsAddressOf, opensSockets: true });

    expect([opening.receives('websocket'), opening.receives('queue')]).toEqual([true, false]);
  });
});

const socketFirst = providersOf({
  ...trackerOverASocket,
  events: { destinations: [overASocket, ofEachSubscription] },
});

const heldBy = (connection: string, appSecretIds: Readonly<Record<string, string>>) =>
  ({
    type: 'connection_connected',
    data: {
      connection,
      secret_id: 'secret-9',
      app_secret_ids: appSecretIds,
      connected_by: { id: 'person:ada', name: 'Ada' },
    },
  }) as const;

describe('a socket among the destinations the loop arranges through', () => {
  it('is left out for a connection that holds no app credential it names, or holds it refused', async () => {
    const facts = [
      addedFact('connection-1', 'holding', 'tracker'),
      addedFact('connection-2', 'without', 'tracker'),
      addedFact('connection-3', 'refused', 'tracker'),
      heldBy('connection-1', { app_level_token: 'secret-1' }),
      heldBy('connection-2', {}),
      heldBy('connection-3', { app_level_token: 'secret-3' }),
      {
        type: 'connection_app_credential_refused',
        data: { connection: 'connection-3', name: 'app_level_token', reason: 'refused' },
      },
    ] as const;
    const registry = await registryOf([connectedAt, facts]);
    const connectionsOf = loopConnectionsOf({ registry, providers: socketFirst });

    const types = (await Effect.runPromise(connectionsOf(alpha))).map(({ destinations }) =>
      destinations.map(({ type }) => type),
    );

    expect(types).toEqual([['websocket', 'webhook'], ['webhook'], ['webhook']]);
  });
});

const waiting = [{ connection: 'tracker', with: { project: 'site' }, sent: { conversation: 'C0123', id: '1699.1' } }];

describe('the ports of the loop', () => {
  it('read the connections of the playbook from the registry given, and the requests and the triggers from the readers given', async () => {
    const read: string[] = [];
    const readOf =
      <A>(what: string, answer: readonly A[]) =>
      ({ playbook }: Readonly<typeof alpha>) =>
        Effect.as(
          Effect.sync(() => read.push(`${what} of ${playbook}`)),
          answer,
        );
    const parts = partsOver(readOf('requests', waiting), readOf('triggers', []));
    const ports = subscriptionLoopPortsOf({ ...parts, registry: await aRegistry() });
    const taken = new Map([['tracker', declared]]);

    const named = (await Effect.runPromise(ports.connectionsOf(alpha))).map(({ connection }) => connection);

    expect(named).toEqual(['tracker', 'notes']);
    expect(await Effect.runPromise(Effect.forEach(ports.askers, (asker) => asker({ ...alpha, taken })))).toEqual([
      [{ connection: 'tracker', topic: 'site', destination: declared[0] }],
      [],
    ]);
    expect(read).toEqual(['requests of alpha', 'triggers of alpha']);
  });

  it('hold at most 8 subscriptions through a connection', () => {
    expect(subscriptionLoopPortsOf(partsOver()).mostPerConnection).toBe(8);
  });
});

describe('a connection given by hand that says how its service sends', () => {
  it('is arranged through as it says, whatever the entries declare, and a recorded description the checks of this release refuse loads and arranges nothing', async () => {
    const parts = { registry: await givenByHand(), providers: providersOf(tracker) };
    const connectionsOf = loopConnectionsOf(parts);
    const at = (connection: string) => Effect.runPromise(deliveryDestinationOf(parts)({ ...alpha, connection }));

    expect(
      (await Effect.runPromise(connectionsOf(alpha))).map(({ connection, destinations }) => [connection, destinations]),
    ).toEqual([
      ['hooks', [throughItsTools]],
      ['refused', []],
      ['tracked', []],
    ]);
    expect([await at('hooks'), await at('refused')]).toEqual([throughItsTools, undefined]);
  });

  it('stays on the timer on a runtime that receives nothing over HTTP or gives no address: nothing is called, kept or recorded', async () => {
    const registry = await givenByHand();
    const request = { connection: 'hooks', with: { project: 'site' }, sent: { conversation: 'C0123', id: '1.1' } };
    const roundOn = async (receiving: Pick<SubscriptionLoopParts, 'receivesOverHttp' | 'eventsAddressOf'>) => {
      const ledger = keptLedger(eventSubscriptions).service;
      const parts = { ...partsOver(() => Effect.succeed([request])), ledger, registry, ...receiving };
      const ports = subscriptionLoopPortsOf(parts);
      return [
        await Effect.runPromise(subscriptionLoopOf(ports)(alpha)),
        await Effect.runPromise(ports.records.read(alpha)),
      ];
    };

    expect(await roundOn({ receivesOverHttp: false, eventsAddressOf })).toEqual([{}, []]);
    expect(await roundOn({ receivesOverHttp: true })).toEqual([{}, []]);
  });
});
