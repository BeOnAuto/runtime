import {
  ConnectionEventSchema,
  connectionsStreamOfOrg,
  eventSubscriptions,
  subscriptionLoopPortsOf,
  subscriptionRecordsOf,
} from '@on.auto/connections';
import { decidedIn, definitionNamesWith, definitionsReadModelOf } from '@on.auto/definitions/testing';
import { openRequests } from '@on.auto/interaction';
import { memoryLedgerWith } from '@on.auto/operations/testing';
import {
  providersShippedRoots,
  readProviders,
  subscriptionLoopOf,
  type LoopConnection,
  type ProviderList,
  type ThroughTheConnection,
} from '@on.auto/providers';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  addedAndConnected,
  connectionsRecorded,
  followedBy,
  playbooksCreated,
} from '../testing/subscriptions/connections-followed.ts';
import { subscriptionLoopPartsOf, subscriptionsServedBy, subscriptionsServingOf } from './served-subscriptions.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const theRepository = 'octo-org/approvals';

const opened = 'com.github.issues.opened';

const listeningForIssues = {
  kind: 'event',
  reference: '/schedule/on',
  filters: [
    {
      reference: '/schedule/on/one',
      type: opened,
      attributes: { type: opened, source: '/connections/github', subject: theRepository },
    },
  ],
} as const;

const ada = { id: 'person:ada', name: 'Ada' };

function aSavedTrigger() {
  const ledger = memoryLedgerWith({
    projections: [...definitionsReadModelOf(['workflow']), eventSubscriptions, openRequests],
    definitionNames: definitionNamesWith([]),
  }).service;
  const saved = {
    type: 'create',
    name: 'triage',
    content: { source: 'triage', triggers: [listeningForIssues] },
    created_by: ada,
    definition_id: 'triage-id',
    by: ada.id,
    at: '2026-11-20T09:00:00.000Z',
  } as const;
  return Effect.runPromise(Effect.as(decidedIn(ledger, alpha, 'workflow', saved), ledger));
}

function aServiceThatSubscribes() {
  const sent: string[] = [];
  const tools: ThroughTheConnection = {
    callOnce: () => Effect.die('a call was sent'),
    requestOnce: ({ method, url }) =>
      Effect.sync(() => {
        sent.push(`${method} ${url}`);
        const answer = method === 'GET' ? { id: 7001, login: 'sam' } : { id: 480_932_108 };
        return { kind: 'answered', outcome: 'result', answer } as const;
      }),
    mostRequestBytesTo: () => 1_048_576,
  };
  const secrets = {
    keep: () => Effect.succeed('secret-1'),
    read: () => Effect.die('a secret was read'),
    forget: () => Effect.die('a secret was forgotten'),
  };
  return { tools, secrets, sent };
}

function aConnectionOf(providers: ProviderList, name: string): readonly LoopConnection[] {
  return providers.providers.flatMap(({ entry }) =>
    entry.name === name
      ? [{ id: `id-of-${name}`, connection: name, destinations: entry.events?.destinations ?? [] }]
      : [],
  );
}

describe('a saved workflow whose trigger names a connection, on a runtime given WEBHOOK_URL', () => {
  it('has the round the server composes subscribe once at the service, for the place the trigger names, with no request waiting', async () => {
    const ledger = await aSavedTrigger();
    const providers = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));
    const { tools, secrets, sent } = aServiceThatSubscribes();
    const receiving = { overHttp: true, webhookUrl: 'https://events.example.com' };
    const ports = subscriptionLoopPortsOf(
      subscriptionLoopPartsOf(subscriptionsServingOf(ledger, { providers, receiving }, { tools, secrets })),
    );
    const round = subscriptionLoopOf({
      ...ports,
      connectionsOf: () => Effect.succeed(aConnectionOf(providers, 'github')),
    });
    await Effect.runPromise(round(alpha));
    await Effect.runPromise(round(alpha));

    expect(sent).toEqual([`POST https://api.github.com/repos/${theRepository}/hooks`]);
    expect(await Effect.runPromise(subscriptionRecordsOf(ledger).read(alpha))).toMatchObject([
      { connection: 'github', topic: theRepository, made: { id: '480932108' } },
    ]);
  });
});

const nine = Date.parse('2026-11-20T09:00:00.000Z');

const github = (connection: string) => addedAndConnected(connection, 'github', 'https://api.githubcopilot.com/mcp/');

async function theServerOf(ledger: Awaited<ReturnType<typeof aSavedTrigger>>, webhookUrl?: string) {
  const providers = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));
  const service = aServiceThatSubscribes();
  const forgotten: string[] = [];
  const secrets = { ...service.secrets, forget: (id: string) => Effect.sync(() => forgotten.push(id)) };
  const receiving = { overHttp: true, webhookUrl };
  const rounds = subscriptionsServedBy(
    subscriptionsServingOf(ledger, { providers, receiving }, { ...service, secrets }),
  );
  return { rounds, sent: service.sent, forgotten, ...followedBy(rounds, ledger, 'acme') };
}

describe('the connections of the orgs, on a runtime that arranges no way', () => {
  it('are followed by no wake-up, since nothing is subscribed per subscription there', async () => {
    const ledger = await aSavedTrigger();
    const streams = { orgStreams: () => Promise.resolve([]) };
    const wakeUpsOf = async (webhookUrl?: string) =>
      (await theServerOf(ledger, webhookUrl)).rounds.wakeUpsOver({ streams }).length;

    expect([await wakeUpsOf(), await wakeUpsOf('https://events.example.com')]).toEqual([0, 1]);
  });
});

describe('a saved workflow whose trigger names a connection that is removed, added again and connected', () => {
  it('has the server ask each connection the account it acts as before it subscribes, record it on the org’s connections, forget the subscription as the connection is removed and subscribe once again as it is connected, with no other fact of the playbook', async () => {
    const ledger = await aSavedTrigger();
    await playbooksCreated(ledger, 'acme', [alpha.playbook]);
    await connectionsRecorded(ledger, 'acme', github('connection-1'));
    const server = await theServerOf(ledger, 'https://events.example.com');
    const context = { at: '2026-11-20T09:00:00.000Z', by: ada.id, definitionType: 'workflow' };
    const saved = { playbook: alpha, record: { id: 'fact-saved', type: 'definition_created', context } };
    const { deliveries } = await Effect.runPromise(server.rounds.consumer.batchOf(saved, undefined, 100));
    await Effect.runPromise(Effect.forEach(deliveries, ({ deliver }) => deliver));
    await server.wokenAt(nine);
    const subscribed = server.sent.length;

    await server.changed([{ type: 'connection_removed', data: { connection: 'connection-1' } }]);
    await server.wokenAt(nine + 1000);
    const forgottenAtTheRemoval = [...server.forgotten];
    await server.changed(github('connection-2'));
    await server.wokenAt(nine + 2000);

    const hooks = `POST https://api.github.com/repos/${theRepository}/hooks`;
    const whoAmI = 'GET https://api.github.com/user';
    expect([subscribed, forgottenAtTheRemoval]).toEqual([2, ['secret-1']]);
    expect(server.sent).toEqual([whoAmI, hooks, whoAmI, hooks]);
    expect(await Effect.runPromise(subscriptionRecordsOf(ledger).read(alpha))).toMatchObject([
      { connection: 'github', topic: theRepository, made: { id: '480932108' } },
    ]);
    expect(await identifiedIn(ledger)).toEqual([
      { connection: 'connection-1', user: { id: '7001', name: 'sam' }, by: 'runtime' },
      { connection: 'connection-2', user: { id: '7001', name: 'sam' }, by: 'runtime' },
    ]);
  });
});

type ConnectionFact = typeof ConnectionEventSchema.Type;

const noFactYet: readonly ConnectionFact[] = [];

const factsRead = {
  initialState: noFactYet,
  evolve: (facts: readonly ConnectionFact[], fact: ConnectionFact) => [...facts, fact],
  eventSchema: ConnectionEventSchema,
};

async function identifiedIn(ledger: Awaited<ReturnType<typeof aSavedTrigger>>) {
  const { state } = await Effect.runPromise(ledger.load(connectionsStreamOfOrg('acme'), factsRead));
  return state.flatMap(({ type, data, context }) =>
    type === 'connection_identified' ? [{ connection: data.connection, user: data.user, by: context.by }] : [],
  );
}
