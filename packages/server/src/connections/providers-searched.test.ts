import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import type { Provider } from '@on.auto/providers';
import { shippedFileIn, type ShippedFile, type ShippedFiles } from '@on.auto/shipped-files';
import { serveFakeApi, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Effect, Option, Schema } from 'effect';
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

const listedWithoutAsking = Option.getOrThrow(
  Option.fromNullishOr(addedByAToken.find(({ entry }) => entry.type === 'openapi')),
);

const addedOverMcp = addedByAToken.filter(({ entry }) => entry.type === 'mcp');

const pendingOne = Option.getOrThrow(Option.fromNullishOr(addedOverMcp[0]));

const brokenOne = Option.getOrThrow(Option.fromNullishOr(addedOverMcp[1]));

function nameOf({ entry }: Provider): string {
  return entry.name;
}

function keyOf({ entry }: Provider, rest: string): string {
  const { example = '' } = entry.credentials.find(({ kind }) => kind === byAToken.kind) ?? {};
  return `${example.replace('…', '')}${rest}`;
}

const lostKey = keyOf(brokenOne, 'lost_1');

const sealedKey = keyOf(listedWithoutAsking, 'sealed_1');

const entries: ShippedFile = { package: '@on.auto/providers', path: 'src/entries' };

const decodeDocument = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

function isTheFile(file: ShippedFile, other: ShippedFile): boolean {
  return file.package === other.package && file.path === other.path;
}

function shippedServingAt({ entry }: Provider, server: string): (files: ShippedFiles) => ShippedFiles {
  const document = shippedFileIn(entries, Option.getOrThrow(Option.fromNullishOr(entry.document)));
  return (files) => {
    const servingThere = async (): Promise<string> => {
      const shipped: unknown = JSON.parse(await files.text(document));
      return JSON.stringify({ ...decodeDocument(shipped), servers: [{ url: server }] });
    };
    return {
      text: (file) => (isTheFile(file, document) ? servingThere() : files.text(file)),
      bytes: async (file) =>
        isTheFile(file, document) ? new TextEncoder().encode(await servingThere()) : files.bytes(file),
      list: files.list,
    };
  };
}

const takingTheKey = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ok: true }),
};

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
  await Effect.runPromise(
    store.forget(Option.getOrThrow(Option.fromNullishOr(await secretIdOf(fileName, 'acme', connection)))),
  );
  await store.close();
}

let ledger: TemporaryLedger | undefined;

afterEach(() => {
  ledger?.remove();
});

async function served(
  environment: Readonly<Record<string, string>> = {},
  parts: Parameters<typeof servingReasoning>[3] = {},
): Promise<ReasoningServer> {
  const server = await servingReasoning([], environment, undefined, parts);
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
    const named = Option.getOrThrow(Option.fromNullishOr(offeredByTheServer[0]));

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
      'No tool server serves this org, so the functions of its playbooks can call no tools until whoever runs this server sets one up, or a person connects a provider this search lists, with add_connection where your tools include it; the give-tools recipe of get_guide says how.';

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
    const service = await serveFakeApi({ key: sealedKey });
    onTestFinished(service.close);
    service.answerNextWith(takingTheKey);
    const kept = { LEDGER_FILE: ledger.fileName, SECRETS_KEY: secretsKey.toString('base64') };
    const shipped = { shippedFilesOver: shippedServingAt(listedWithoutAsking, service.baseUrl) };
    const first = await served(kept, shipped);
    const lost = await connectedWith(first, { provider: nameOf(brokenOne), credential: byAToken }, lostKey);
    await first.stop();
    await forgottenIn(ledger.fileName, lost);
    const restarted = await served(kept, shipped);
    await restarted.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const pending = await addedConnection(restarted, { provider: nameOf(pendingOne), credential: byAToken });

    const whilePending = await restarted.call('GET', searchOfAcme);
    const narrowed = { playbooks: ['alpha'], record_content: false };
    await connectedWith(restarted, { provider: nameOf(listedWithoutAsking), entry: narrowed }, sealedKey);
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
