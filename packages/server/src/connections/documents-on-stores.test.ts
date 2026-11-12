import { randomUUID } from 'node:crypto';

import { serveFakeApi } from '@on.auto/tool-servers/served-fakes';
import { fakeApiDocument } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { connectedWith } from '../testing/servers/connected-servers.ts';
import { connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const notice =
  postgresql === '' ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const key = 'ledgers-key-5d20c7e1';

const CursorSchema = Schema.Struct({ cursor: Schema.String });

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

function onSQLite(): Promise<Readonly<Record<string, string>>> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({ LEDGER_FILE: ledger.fileName });
}

async function onPostgreSQL(): Promise<Readonly<Record<string, string>>> {
  const name = `documents_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(() => administer(`DROP DATABASE ${name} WITH (FORCE)`));
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LEDGER_FILE: '', DATABASE_URL: database.href };
}

interface Store {
  readonly store: string;
  readonly skipped: boolean;
  readonly aPlace: () => Promise<Readonly<Record<string, string>>>;
}

const stores: readonly Store[] = [
  { store: 'SQLite', skipped: false, aPlace: onSQLite },
  { store: `PostgreSQL${notice}`, skipped: postgresql === '', aPlace: onPostgreSQL },
];

async function servedOn(place: Readonly<Record<string, string>>): Promise<ReasoningServer> {
  const server = await servingReasoning([], {
    ...place,
    SECRETS_KEY: Buffer.alloc(32, 5).toString('base64'),
    ...connectionsOnLoopback,
  });
  const stopping: { done?: Promise<void> } = {};
  const stop = (): Promise<void> => {
    stopping.done ??= server.stop();
    return stopping.done;
  };
  onTestFinished(stop);
  return { ...server, stop };
}

function documentText(): string {
  const written = fakeApiDocument('3.1', 'https://elsewhere.example.com/v1', false);
  return JSON.stringify({
    ...written,
    paths: {
      '/search': {
        get: {
          operationId: 'search',
          parameters: [{ name: 'query', in: 'query', required: true, schema: { type: 'string' } }],
        },
      },
    },
  });
}

function described(baseUrl: string) {
  return {
    name: 'ledgers',
    type: 'openapi',
    entry: { base_url: baseUrl, document_text: documentText() },
    credential: {
      kind: 'secret',
      name: 'X-Api-Key',
      in: 'header',
      instructions: 'Make a key under [Settings, API keys](https://ledgers.example.com/settings/keys).',
      key_page: 'https://ledgers.example.com/settings/keys',
    },
  };
}

function searched(server: ReasoningServer) {
  return server.call('POST', `${alpha}/tool-servers/ledgers/tools/search/execute`, {
    body: { arguments: { query: 'acme' } },
  });
}

describe.each(stores)('an HTTP API given its OpenAPI document whole, on $store', ({ skipped, aPlace }: Store) => {
  it.skipIf(skipped)(
    'is served from the document kept in a stream of its own, beside an org change feed that reads none, and again after a restart',
    async () => {
      const fake = await serveFakeApi({ key, declaresKey: false });
      onTestFinished(fake.close);
      const place = await aPlace();
      const first = await servedOn(place);
      await first.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      const since = Schema.decodeUnknownSync(CursorSchema)((await first.call('GET', '/v1/orgs/acme/changes')).body);
      const id = await connectedWith(first, described(fake.baseUrl), key);

      const changes = await first.call('GET', `/v1/orgs/acme/changes?since=${since.cursor}`);
      const before = await searched(first);
      await first.stop();
      const restarted = await servedOn(place);
      const after = await searched(restarted);

      expect(changes).toMatchObject({ status: 200, body: { changes: [{ kind: 'connection', connection: id }] } });
      expect([before.status, after.status]).toEqual([200, 200]);
      expect(fake.seen()).toMatchObject([
        { method: 'GET', path: '/v1/search', query: '?query=acme' },
        { method: 'GET', path: '/v1/search', query: '?query=acme' },
      ]);
      expect(fake.documentReads()).toBe(0);
    },
  );
});
