import { memoryLedger } from '@on.auto/operations/testing';
import { placeNamesReadOf, type ThroughTheConnection } from '@on.auto/providers';
import {
  ofEachSubscription,
  postTypeNamedBy,
  providersOf,
  readingTheRoomsName,
  throughItsTools,
  tracker,
} from '@on.auto/providers/testing';
import type { CalledOnce } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { addedFact, factsIn, registryOf } from '../testing/loop-registries.ts';
import { loopConnectionsOf } from './loop-connections.ts';
import { subscriptionLoopPortsOf, type SubscriptionLoopParts } from './loop-ports.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const addedAt = '2026-11-17T07:00:00.000Z';

const connectedAt = '2026-11-17T08:00:00.000Z';

const posted = 'com.example.chat.post';

const providers = providersOf(
  { ...tracker, events: { destinations: [ofEachSubscription] } },
  {
    ...tracker,
    name: 'rooms',
    title: 'Rooms',
    events: { types: [postTypeNamedBy(readingTheRoomsName)], destinations: [ofEachSubscription] },
  },
);

const [declaredName] = providers.providers.flatMap(({ entry }) =>
  (entry.events?.types ?? []).flatMap(({ subject }) => (subject?.name === undefined ? [] : [subject.name])),
);

function connected(connection: string) {
  return {
    type: 'connection_connected',
    data: { connection, connected_by: { id: 'person:ada', name: 'Ada' } },
  } as const;
}

function placeNamed(connection: string, subject: string) {
  return {
    type: 'connection_place_named',
    data: { connection, connected_at: connectedAt, event_type: posted, subject, name: `room ${subject}` },
  } as const;
}

describe('how a connection’s places are named, as the loop reads its connections', () => {
  it('is what its entry declares for each type, with the places named for its connecting, for a connection connected; and nothing for one pending, broken, given by hand or of an entry that declares none', async () => {
    const added = [
      addedFact('connection-1', 'rooms', 'rooms'),
      addedFact('connection-2', 'named', 'rooms'),
      addedFact('connection-3', 'waiting', 'rooms'),
      addedFact('connection-4', 'broken', 'rooms'),
      addedFact('connection-5', 'by-hand', null, { events: { destinations: [throughItsTools] } }),
      addedFact('connection-6', 'tracker', 'tracker'),
    ];
    const connecting = ['connection-1', 'connection-2', 'connection-4', 'connection-5', 'connection-6'].map(
      (connection) => connected(connection),
    );
    const named = [placeNamed('connection-2', 'C1'), placeNamed('connection-2', 'C2')];
    const broken = {
      type: 'connection_broken',
      data: { connection: 'connection-4', kind: 'credential_refused', reason: 'Refused' },
    } as const;
    const registry = await registryOf([addedAt, added], [connectedAt, [...connecting, ...named, broken]]);
    const connections = await Effect.runPromise(loopConnectionsOf({ registry, providers })(alpha));

    expect(connections.map(({ connection, placeNaming }) => [connection, placeNaming])).toEqual([
      ['rooms', [{ type: posted, name: declaredName, named: [] }]],
      ['named', [{ type: posted, name: declaredName, named: ['C1', 'C2'] }]],
      ['waiting', undefined],
      ['broken', undefined],
      ['by-hand', undefined],
      ['tracker', undefined],
    ]);
  });
});

const answered: CalledOnce = {
  kind: 'answered',
  mark: 'reads',
  detail: '',
  retryAfterMs: null,
  outcome: 'result',
  answer: { content: [], structuredContent: { room: { title: 'support' } } },
  answered: { is_error: false, result_bytes: 2, duration_ms: 1, jsonrpc_id: 1 },
};

function aRoomsService() {
  const called: string[] = [];
  const tools: ThroughTheConnection = {
    callOnce: ({ reference, input, requiredMark }) =>
      Effect.sync(() => {
        called.push(`${reference.tool} ${JSON.stringify(input)} ${String(requiredMark)}`);
        return answered;
      }),
    requestOnce: () => Effect.die('a request was sent'),
    mostRequestBytesTo: () => 1_048_576,
  };
  return { tools, called };
}

function partsOver(registry: SubscriptionLoopParts['registry'], tools: ThroughTheConnection): SubscriptionLoopParts {
  const secrets = {
    keep: () => Effect.die('kept'),
    read: () => Effect.die('read'),
    forget: () => Effect.die('forgot'),
  };
  return {
    ledger: memoryLedger().service,
    registry,
    waitingIn: () => Effect.succeed([]),
    triggersIn: () => Effect.succeed([]),
    tools,
    secrets,
    providers,
    receivesOverHttp: true,
  };
}

async function placesNamedIn(registry: SubscriptionLoopParts['registry']) {
  return (await factsIn(registry)).flatMap(({ type, data, context }) =>
    type === 'connection_place_named' ? [{ ...data, by: context.by } as const] : [],
  );
}

const aRoomsConnection = () =>
  registryOf([addedAt, [addedFact('connection-1', 'rooms', 'rooms')]], [connectedAt, [connected('connection-1')]]);

describe('the name of a place a connection reaches, as a round records it', () => {
  it('is recorded on the org’s connections by the runtime, for the connecting it was read for, and a second read of the same name records nothing', async () => {
    const registry = await aRoomsConnection();
    const ports = subscriptionLoopPortsOf(partsOver(registry, aRoomsService().tools));
    const recordedOnce = () =>
      Effect.runPromise(
        ports.placeNamed(
          alpha,
          { id: 'connection-1', connected: connectedAt },
          { type: posted, subject: 'C1', name: 'support' },
        ),
      );
    await recordedOnce();
    await recordedOnce();

    expect(await placesNamedIn(registry)).toEqual([
      {
        connection: 'connection-1',
        connected_at: connectedAt,
        event_type: posted,
        subject: 'C1',
        name: 'support',
        by: 'runtime',
      },
    ]);
  });

  it('is read through the connection, through a tool that must be marked reads, for each place a trigger names, once, after which the connection owes it no more', async () => {
    const registry = await aRoomsConnection();
    const { tools, called } = aRoomsService();
    const ports = subscriptionLoopPortsOf(partsOver(registry, tools));
    const read = async () =>
      Effect.runPromise(
        placeNamesReadOf(ports)(alpha, await Effect.runPromise(ports.connectionsOf(alpha)), [
          { connection: 'rooms', type: posted, subject: 'C1' },
        ]),
      );
    await read();
    await read();

    expect(called).toEqual(['room_info {"room":"C1"} reads']);
    expect((await placesNamedIn(registry)).map(({ subject, name }) => [subject, name])).toEqual([['C1', 'support']]);
  });
});
