import { memoryLedger } from '@on.auto/operations/testing';
import { subscriptionLoopOf, type ThroughTheConnection } from '@on.auto/providers';
import { ofEachSubscription, providersOf, tracker } from '@on.auto/providers/testing';
import type { CalledOnce } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { addedFact, factsIn, recordedIn, registryOf } from '../testing/loop-registries.ts';
import { loopConnectionsOf } from './loop-connections.ts';
import { subscriptionLoopPortsOf, type SubscriptionLoopParts } from './loop-ports.ts';
import { eventSubscriptions } from './subscription-rows.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const addedAt = '2026-11-17T07:00:00.000Z';

const connectedAt = '2026-11-17T08:00:00.000Z';

const viewing = { tool: 'who_is_this', identified: { id: '/data/viewer/handle_id', name: '/data/viewer/label' } };

const commented = {
  type: 'com.example.board.comment',
  title: 'A comment is made',
  subject: { title: 'Board', required: true },
  data: { type: 'object', properties: { words: { type: 'string' } } },
};

const ofEachBoard = {
  ...ofEachSubscription,
  events: [
    {
      type: commented.type,
      when: { '$request.body#/kind': ['comment'] },
      id: ['$request.body#/comment/id'],
      subject: '$request.body#/comment/board',
      data: { words: '$request.body#/comment/words' },
      actor: '$request.body#/comment/by',
      topic: '{{ subject }}',
    },
  ],
};

const boards = providersOf(
  { ...tracker, name: 'boards', events: { types: [commented], identity: viewing, destinations: [ofEachBoard] } },
  { ...tracker, events: { destinations: [ofEachSubscription] } },
);

function connected(connection: string, by = 'person:ada') {
  return { type: 'connection_connected', data: { connection, connected_by: { id: by, name: 'Ada' } } } as const;
}

const added = [
  addedFact('connection-1', 'boards', 'boards'),
  addedFact('connection-2', 'waiting', 'boards'),
  addedFact('connection-3', 'tracker', 'tracker'),
  addedFact('connection-4', 'broken', 'boards'),
  { type: 'connection_broken', data: { connection: 'connection-4', kind: 'credential_refused', reason: 'Refused' } },
] as const;

function aRegistry() {
  return registryOf(
    [addedAt, [added[0], added[1], added[2], added[3]]],
    [connectedAt, [connected('connection-1'), connected('connection-3'), connected('connection-4'), added[4]]],
  );
}

describe('the call a connection still owes, as the loop reads its connections', () => {
  it('is the identity its entry declares, for a connection connected that holds no answer for its connecting, and none for one pending, broken or of an entry that declares none', async () => {
    const connections = await Effect.runPromise(
      loopConnectionsOf({ registry: await aRegistry(), providers: boards })(alpha),
    );

    expect(connections.map(({ connection, identify }) => [connection, identify])).toEqual([
      ['boards', viewing],
      ['waiting', undefined],
      ['tracker', undefined],
      ['broken', undefined],
    ]);
  });
});

const answered = (document: object): CalledOnce => ({
  kind: 'answered',
  mark: 'reads',
  detail: '',
  retryAfterMs: null,
  outcome: 'result',
  answer: { content: [], structuredContent: { ...document } },
  answered: { is_error: false, result_bytes: 2, duration_ms: 1, jsonrpc_id: 1 },
});

function aService() {
  const sent: string[] = [];
  const tools: ThroughTheConnection = {
    callOnce: ({ reference }) =>
      Effect.sync(() => {
        sent.push(reference.tool);
        return answered({ data: { viewer: { handle_id: 'h-7', label: 'sam' } } });
      }),
    requestOnce: ({ method }) =>
      Effect.sync(() => {
        sent.push(method);
        return { kind: 'answered', outcome: 'result', answer: { id: `hook-${sent.length}` } };
      }),
    mostRequestBytesTo: () => 1_048_576,
  };
  return { tools, sent };
}

function partsOver(registry: SubscriptionLoopParts['registry'], tools: ThroughTheConnection): SubscriptionLoopParts {
  return {
    ledger: memoryLedger(undefined, [eventSubscriptions]).service,
    registry,
    waitingIn: () => Effect.succeed([]),
    triggersIn: () => Effect.succeed([{ connection: 'boards', type: commented.type, subject: 'B0SITE' }]),
    tools,
    secrets: {
      keep: (value: Redacted.Redacted) => Effect.succeed(`secret-of-${Redacted.value(value).length}`),
      read: () => Effect.die('a secret was read'),
      forget: () => Effect.void,
    },
    providers: boards,
    receivesOverHttp: true,
    eventsAddressOf: ({ connection }) => `https://runtime.example.com/${connection}`,
  };
}

async function identifiedIn(registry: SubscriptionLoopParts['registry']) {
  return (await factsIn(registry)).flatMap(({ type, data, context }) =>
    type === 'connection_identified' ? [{ ...data, by: context.by }] : [],
  );
}

describe('a round through a connection whose entry declares how to ask the account it acts as', () => {
  it('asks it through the connection before it subscribes, records it on the org’s connections by the runtime, and asks no more for that connecting', async () => {
    const registry = await aRegistry();
    const { tools, sent } = aService();
    const ports = subscriptionLoopPortsOf(partsOver(registry, tools));
    await Effect.runPromise(subscriptionLoopOf(ports)(alpha));
    await Effect.runPromise(subscriptionLoopOf(ports)(alpha));

    expect(sent).toEqual(['who_is_this', 'POST']);
    expect(await identifiedIn(registry)).toEqual([
      { connection: 'connection-1', connected_at: connectedAt, user: { id: 'h-7', name: 'sam' }, by: 'runtime' },
    ]);
  });

  it('asks again once the connection is connected again, since the person may have signed in as someone else', async () => {
    const registry = await aRegistry();
    const { tools, sent } = aService();
    const ports = subscriptionLoopPortsOf(partsOver(registry, tools));
    const connectedAgainAt = '2026-11-18T08:00:00.000Z';
    await Effect.runPromise(subscriptionLoopOf(ports)(alpha));
    await recordedIn(registry, [connectedAgainAt, [connected('connection-1', 'person:grace')]]);
    await Effect.runPromise(subscriptionLoopOf(ports)(alpha));

    expect(sent).toEqual(['who_is_this', 'POST', 'who_is_this']);
    expect(await identifiedIn(registry)).toMatchObject([
      { connected_at: connectedAt },
      { connected_at: connectedAgainAt },
    ]);
  });
});
