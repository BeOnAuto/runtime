import { makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defineListConnectionTools, defineSearch, defineSearchInOrg } from '../index.ts';
import { fakeConnections } from '../testing/fake-connections.ts';
import { patientTiming } from '../testing/index.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';

const reader: CallerIdentity = {
  id: 'acme-reader',
  name: 'acme-reader',
  org: 'acme',
  permissions: ['org:read'],
  playbooks: '*',
};

const services = Layer.mergeAll(memoryLedger().layer, memoryPlaybookRegistry([]), recordingReporter().layer);

const environment = { GRAPH_API_KEY: fakeApiKey };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function connectedAccess() {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const entry = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } };
  const connections = fakeConnections();
  connections.connect('acme', { id: 'chat-id', name: 'chat', environment, renders: 'cards', entry });
  connections.connect('acme', { id: 'plain-id', name: 'plain', environment, entry });
  const { access } = reportingAccess({}, { timing: patientTiming, connections });
  closing.push(access.close);
  return access;
}

function dispatchedTo(registration: Parameters<ReturnType<typeof makeDispatcher>['dispatchToOrg']>[0]) {
  return (input: unknown): Promise<Outcome> =>
    Effect.runPromise(
      makeDispatcher([])
        .dispatchToOrg(registration, { caller: reader, org: 'acme', input, encoding: 'strings' })
        .pipe(Effect.provide(services)),
    );
}

const cardWords =
  'A message sent through “chat” can be a card with fields, a table, a chart and link buttons: write it in an interaction function with render: cards, and read the guide render-cards.';

const listing = {
  listServers: () => Effect.succeed([]),
  listServersInOrg: () => Effect.succeed({ servers: [], settings: [] }),
  takesConnections: false,
};

function chat(extra: object) {
  return { name: 'chat', type: 'mcp', record_content: true, provider: null, renders: 'cards', ...extra } as const;
}

const plain = { name: 'plain', type: 'mcp', record_content: true, provider: null, tool_count: 1 } as const;

const anyRenders: unknown = expect.any(String);

function withoutRenders(): unknown {
  return expect.not.objectContaining({ renders: anyRenders });
}

const down = { unavailable: 'down', because: 'unreachable' } as const;

describe('search, for a server whose provider renders', () => {
  it('shows renders on the row of that server alone', async () => {
    const searched = dispatchedTo(defineSearchInOrg(await connectedAccess(), () => Effect.void).registration);

    expect(await searched({})).toMatchObject({
      status: 'succeeded',
      output: {
        servers: [{ name: 'chat', renders: 'cards' }, withoutRenders()],
      },
    });
  });

  it('says in words that a message through it can be a card, with terms and without', () => {
    const { plainLanguage } = defineSearchInOrg(listing, () => Effect.void).registration;
    const servers = [{ ...chat({ tool_count: 1 }), playbooks: ['*'] }];
    const tool = { server: 'chat', tool: 'echo', summary: '', mark: 'unmarked' } as const;

    expect([
      plainLanguage?.outcome({ servers, tools: [tool], scopes: ['chat'] }, {}),
      plainLanguage?.outcome({ servers, tools: [tool], scopes: ['chat'] }, { terms: 'echo' }),
    ]).toEqual([expect.stringContaining(cardWords), expect.stringContaining(cardWords)]);
  });

  it('says it in the search of a playbook too', () => {
    const { plainLanguage } = defineSearch(listing).registration;

    expect(plainLanguage?.outcome({ servers: [chat({ tool_count: 0 })], tools: [], scopes: ['chat'] }, {})).toContain(
      cardWords,
    );
  });

  it('says nothing of cards for a server that cannot be asked, or whose provider renders nothing', () => {
    const { plainLanguage } = defineSearchInOrg(listing, () => Effect.void).registration;
    const servers = [
      { ...plain, playbooks: ['*'] },
      { ...chat(down), playbooks: ['*'] },
    ];

    expect(plainLanguage?.outcome({ servers, tools: [], scopes: ['plain', 'chat'] }, {})).not.toContain('card');
  });
});

describe('list_connection_tools, for a connection whose provider renders', () => {
  it('shows renders for it, and for no other', async () => {
    const listed = dispatchedTo(defineListConnectionTools(await connectedAccess()).registration);

    expect(await listed({ id: 'chat-id' })).toMatchObject({
      status: 'succeeded',
      output: { server: 'chat', renders: 'cards' },
    });
    expect(await listed({ id: 'plain-id' })).toMatchObject({
      status: 'succeeded',
      output: withoutRenders(),
    });
  });

  it('says in words that a message through it can be a card, and says it of no other', () => {
    const { plainLanguage } = defineListConnectionTools({ listConnection: () => Effect.undefined }).registration;
    const page = { connection: 'chat-id', server: 'chat', tools: [], has_more: false, next_cursor: null } as const;

    expect([
      plainLanguage?.outcome({ ...page, renders: 'cards' }, { id: 'chat-id' }),
      plainLanguage?.outcome(page, { id: 'chat-id' }),
    ]).toEqual([
      `The connection “chat” offers 0 tools on this page. ${cardWords}`,
      'The connection “chat” offers 0 tools on this page.',
    ]);
  });
});
