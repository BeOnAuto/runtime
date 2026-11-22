import {
  ConnectionEventSchema,
  connectionsStreamOfOrg,
  eventSubscriptions,
  subscriptionRecordsOf,
} from '@on.auto/connections';
import { decidedIn, definitionNamesWith, definitionsReadModelOf } from '@on.auto/definitions/testing';
import { openRequests } from '@on.auto/interaction';
import { memoryLedgerWith } from '@on.auto/operations/testing';
import { providersOf, readingTheRoomsName, throughItsTools, tracker } from '@on.auto/providers/testing';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { addedAndConnected, connectionsRecorded } from '../testing/subscriptions/connections-followed.ts';
import { subscriptionsServedBy, subscriptionsServingOf } from './served-subscriptions.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

type ThroughTheConnection = Parameters<typeof subscriptionsServingOf>[2]['tools'];

type CalledOnce = Effect.Success<ReturnType<ThroughTheConnection['callOnce']>>;

const theWebhookUrl = 'https://events.example.com';

const noCalls: ThroughTheConnection = {
  callOnce: () => Effect.die('a call was sent'),
  requestOnce: () => Effect.die('a request was sent'),
  mostRequestBytesTo: () => 1_048_576,
};

const noSecrets = {
  keep: () => Effect.succeed('secret-1'),
  read: () => Effect.die('a secret was read'),
  forget: () => Effect.die('a secret was forgotten'),
};

const posted = 'com.example.chat.post';

const roomsNamingTheirPlaces = providersOf({
  ...tracker,
  name: 'rooms',
  title: 'Rooms',
  events: {
    types: [
      {
        type: posted,
        title: 'A post is made',
        subject: { title: 'Room', required: true, name: readingTheRoomsName },
        data: { type: 'object' },
      },
    ],
    destinations: [
      {
        ...throughItsTools,
        events: [
          {
            type: posted,
            when: { '$request.body#/kind': ['post'] },
            id: ['$request.body#/post/room', '$request.body#/post/seq'],
            subject: '$request.body#/post/room',
            topic: '{{ subject }}',
          },
        ],
      },
    ],
  },
});

const answeredBy = (structuredContent: Readonly<Record<string, Schema.Json>>): CalledOnce => ({
  kind: 'answered',
  mark: 'reads',
  detail: '',
  retryAfterMs: null,
  outcome: 'result',
  answer: { content: [], structuredContent: { ...structuredContent } },
  answered: { is_error: false, result_bytes: 2, duration_ms: 1, jsonrpc_id: 1 },
});

const unreachable: CalledOnce = { kind: 'unopened', refused: 'tool_server_failed', because: 'unreachable', detail: '' };

function roomsService(naming: 'answers' | 'fails') {
  const sent: string[] = [];
  const tools: ThroughTheConnection = {
    ...noCalls,
    callOnce: ({ reference, requiredMark }) =>
      Effect.sync(() => {
        sent.push(`${reference.tool} ${requiredMark ?? 'any'}`);
        if (reference.tool === 'room_info') {
          return naming === 'answers' ? answeredBy({ room: { title: 'support' } }) : unreachable;
        }
        return answeredBy({ id: 'hook-1' });
      }),
  };
  return { tools, sent };
}

async function aPlaybookListeningInTheRoom() {
  const ledger = memoryLedgerWith({
    projections: [...definitionsReadModelOf(['workflow']), eventSubscriptions, openRequests],
    definitionNames: definitionNamesWith([]),
  }).service;
  const attributes = { type: posted, source: '/connections/rooms', subject: 'C1' };
  const filters = [{ reference: '/schedule/on/one', type: posted, attributes }];
  const ada = { id: 'person:ada', name: 'Ada' };
  await Effect.runPromise(
    decidedIn(ledger, alpha, 'workflow', {
      type: 'create',
      name: 'on-a-post',
      content: { source: 'on-a-post', triggers: [{ kind: 'event', reference: '/schedule/on', filters }] },
      created_by: ada,
      definition_id: 'on-a-post-id',
      by: ada.id,
      at: '2026-11-20T09:00:00.000Z',
    }),
  );
  await connectionsRecorded(
    ledger,
    'acme',
    addedAndConnected('connection-1', 'rooms', 'https://rooms.example.com/mcp'),
  );
  return ledger;
}

async function roundOfTheServer(naming: 'answers' | 'fails', webhookUrl?: string) {
  const ledger = await aPlaybookListeningInTheRoom();
  const { tools, sent } = roomsService(naming);
  const receiving = { overHttp: true, webhookUrl };
  const served = subscriptionsServedBy(
    subscriptionsServingOf(ledger, { providers: roomsNamingTheirPlaces, receiving }, { tools, secrets: noSecrets }),
  );
  served.asked(alpha);
  const items = await Effect.runPromise(served.dueWork.due(0, 16, true));
  await Effect.runPromise(Effect.forEach(items, (item) => item.perform(0), { discard: true }));
  const recorded = await Effect.runPromise(subscriptionRecordsOf(ledger).read(alpha));
  return { sent, named: await placesNamedIn(ledger), recorded: recorded.map(({ topic, made }) => [topic, made?.id]) };
}

type ConnectionFact = typeof ConnectionEventSchema.Type;

const noFactYet: readonly ConnectionFact[] = [];

const factsRead = {
  initialState: noFactYet,
  evolve: (facts: readonly ConnectionFact[], fact: ConnectionFact) => [...facts, fact],
  eventSchema: ConnectionEventSchema,
};

async function placesNamedIn(ledger: Awaited<ReturnType<typeof aPlaybookListeningInTheRoom>>) {
  const { state } = await Effect.runPromise(ledger.load(connectionsStreamOfOrg('acme'), factsRead));
  return state.flatMap(({ type, data, context }) =>
    type === 'connection_place_named' ? [[data.event_type, data.subject, data.name, context.by]] : [],
  );
}

describe('a round the server composes, through a connection whose entry says how to read the name of a place', () => {
  it('names the place a trigger listens in last, after the loop subscribed, through a tool that must be marked reads', async () => {
    expect(await roundOfTheServer('answers', theWebhookUrl)).toEqual({
      sent: ['create_hook any', 'room_info reads'],
      named: [[posted, 'C1', 'support', 'runtime']],
      recorded: [['C1', 'hook-1']],
    });
  });

  it('ends the same where the name cannot be read, with nothing named', async () => {
    expect(await roundOfTheServer('fails', theWebhookUrl)).toEqual({
      sent: ['create_hook any', 'room_info reads'],
      named: [],
      recorded: [['C1', 'hook-1']],
    });
  });

  it('names the place on a runtime that takes no inbound connection, where its loop takes no step', async () => {
    expect(await roundOfTheServer('answers')).toEqual({
      sent: ['room_info reads'],
      named: [[posted, 'C1', 'support', 'runtime']],
      recorded: [],
    });
  });
});
