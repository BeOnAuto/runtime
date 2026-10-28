import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { required } from '@on.auto/operations';
import type { Provider } from '@on.auto/providers';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { secretIdOf, secretsKey, secretStoreInFile } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import {
  addedConnection,
  answerFieldsOf,
  connectedWith,
  connectionsOfAcme,
  offeredByTheServer,
  shippedProviders,
} from '../testing/servers/connected-servers.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const byAToken = { kind: 'secret' };

const addedByAToken = shippedProviders.filter(
  ({ entry }) => entry.placeholders === undefined && entry.credentials.some((way) => way.kind === byAToken.kind),
);

const listedWithoutAsking = required(addedByAToken.find(({ entry }) => entry.type === 'openapi'));

const addedOverMcp = addedByAToken.filter(({ entry }) => entry.type === 'mcp');

const pendingOne = required(addedOverMcp[0]);

const brokenOne = required(addedOverMcp[1]);

function nameOf({ entry }: Provider): string {
  return entry.name;
}

function offeredBut(...connected: readonly Provider[]) {
  const names: ReadonlySet<string> = new Set(connected.map((provider) => nameOf(provider)));
  return offeredByTheServer.filter(({ name }) => !names.has(name));
}

const anyCount: unknown = expect.any(Number);

function searchedAs(states: ReadonlyMap<Provider, Readonly<Record<string, unknown>>>) {
  return shippedProviders
    .filter((provider) => states.has(provider))
    .map((provider) => Object.assign({ name: nameOf(provider), provider: nameOf(provider) }, states.get(provider)));
}

const searchOfAcme = '/v1/orgs/acme/tool-servers/search';

async function forgottenIn(fileName: string, connection: string): Promise<void> {
  const store = await secretStoreInFile(fileName, secretsKey);
  await Effect.runPromise(store.forget(required(await secretIdOf(fileName, 'acme', connection))));
  await store.close();
}

let ledger: TemporaryLedger | undefined;

afterEach(() => {
  ledger?.remove();
});

async function served(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  const server = await servingReasoning([], environment);
  const stopping: { done?: Promise<void> } = {};
  const stop = (): Promise<void> => {
    stopping.done ??= server.stop();
    return stopping.done;
  };
  onTestFinished(stop);
  return { ...server, stop };
}

describe('the providers the search of an org lists to the local developer', () => {
  it('are, without terms, the providers it ships, by name, and with terms the best first', async () => {
    const server = await served();
    const named = required(offeredByTheServer[0]);

    const [whole, found] = await Promise.all([
      server.call('GET', searchOfAcme),
      server.call('GET', `${searchOfAcme}?terms=${named.name}`),
    ]);

    expect(whole).toMatchObject({
      status: 200,
      body: { servers: [], tools: [], scopes: [], providers: offeredByTheServer },
    });
    expect(found).toMatchObject({ status: 200 });
    expect(found.body).toHaveProperty(['providers', 0], named);
    expect(offeredByTheServer.length).toBeGreaterThan(1);
  });

  it('are said in the words of an empty search over MCP, on /mcp and on the org endpoint', async () => {
    const server = await served();
    const said =
      'No tool server serves this org, so the functions of its playbooks can call no tools until whoever runs this server sets one up, or a person connects a provider this search lists, with add_connection where your tools include it; the give-tools guide says how.';

    const searched = await Promise.all(
      ['/mcp', '/orgs/local/mcp'].map((path) =>
        withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, (session) =>
          session.callTool('search', {}),
        ),
      ),
    );

    expect(searched.map((answer) => plainTextIn(answer))).toEqual([said, said]);
    expect(searched.map(({ structuredContent }) => structuredContent)).toMatchObject([
      { providers: offeredByTheServer },
      { providers: offeredByTheServer },
    ]);
  });
});

describe('a provider a connection of the org serves', () => {
  it('is left out while the connection is pending, connected or broken, its server searched with the provider, and listed again once it is removed', async () => {
    ledger = temporaryLedger();
    const kept = { LEDGER_FILE: ledger.fileName };
    const first = await served({ ...kept, SECRETS_KEY: secretsKey.toString('base64') });
    const lost = await connectedWith(
      first,
      { provider: nameOf(brokenOne), credential: byAToken },
      'token-lost-before-the-restart',
    );
    await first.stop();
    await forgottenIn(ledger.fileName, lost);
    const restarted = await served({ ...kept, SECRETS_KEY: secretsKey.toString('base64') });
    await restarted.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const pending = await addedConnection(restarted, { provider: nameOf(pendingOne), credential: byAToken });

    const whilePending = await restarted.call('GET', searchOfAcme);
    const narrowed = { playbooks: ['alpha'], record_content: false };
    await connectedWith(restarted, { provider: nameOf(listedWithoutAsking), entry: narrowed }, 'token-sealed-under-it');
    await restarted.call('DELETE', `${connectionsOfAcme}/${pending.id}`);
    const onceRemoved = await restarted.call('GET', searchOfAcme);

    expect(whilePending).toMatchObject({
      status: 200,
      body: {
        servers: searchedAs(
          new Map([
            [pendingOne, { because: 'connection_pending' }],
            [brokenOne, { because: 'connection_broken' }],
          ]),
        ),
        providers: offeredBut(pendingOne, brokenOne),
      },
    });
    expect(onceRemoved).toMatchObject({
      status: 200,
      body: {
        servers: searchedAs(
          new Map([
            [brokenOne, { because: 'connection_broken' }],
            [listedWithoutAsking, { ...narrowed, tool_count: anyCount }],
          ]),
        ),
        providers: offeredBut(brokenOne, listedWithoutAsking),
      },
    });
    expect(offeredBut(pendingOne, brokenOne).map(({ name }) => name)).toContain(nameOf(listedWithoutAsking));
    expect(offeredBut(brokenOne, listedWithoutAsking).map(({ name }) => name)).toContain(nameOf(pendingOne));
  });
});

describe('the providers of a search the caller may not add from', () => {
  it('are left out on a runtime that lets nobody add, with a server named, and from the search of a playbook, and kept with a playbook', async () => {
    const server = await served();
    const closed = await served({ CONNECTIONS: JSON.stringify({ people_may_add: false }) });
    const notes = await serveFakeMcp();
    onTestFinished(notes.close);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await addedConnection(server, {
      name: 'notes',
      type: 'mcp',
      entry: { url: notes.url },
      credential: { kind: 'none' },
    });

    const answers = await Promise.all([
      closed.call('GET', searchOfAcme),
      server.call('GET', `${searchOfAcme}?server=notes`),
      server.call('GET', '/v1/orgs/acme/playbooks/alpha/tool-servers/search'),
      server.call('GET', `${searchOfAcme}?playbook=alpha`),
    ]);

    expect(answers.map(({ body }) => answerFieldsOf(body))).toEqual([
      ['servers', 'tools', 'scopes'],
      ['servers', 'tools', 'scopes'],
      ['servers', 'tools', 'scopes'],
      ['servers', 'tools', 'scopes', 'providers'],
    ]);
  });
});
