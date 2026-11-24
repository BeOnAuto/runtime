import type { FetchLike } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { shippedDocumentOf, type ApiDocumentSource } from '../settings/server-settings.ts';
import type { McpServerSettings, OpenApiServerSettings } from '../settings/server-settings.ts';
import { fakeApiDocument, fakeMcpInProcess, inProcessFetch } from '../testing/index.ts';
import type { FakeMcpServer } from '../testing/served-fakes.ts';
import { clientSecret, secretAuth } from '../testing/token-sources.ts';
import { connectionTokensCheckedOf } from './connection-token-checks.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const atTheMoment = () => Date.parse('2026-11-24T09:00:00.000Z');

const theApi = 'https://api.example.com/v1';

function issuerOf(secret = clientSecret): FakeMcpServer {
  const fake = fakeMcpInProcess({ client: { clientId: 'playbook', clientSecret: secret, expiresInSeconds: 3600 } });
  closing.push(fake.close);
  return fake;
}

const servedBy = {
  name: 'graph',
  headers: new Map(),
  orgs: ['acme'],
  playbooks: null,
  allowed: null,
  marks: { reads: [], acts: [] },
  record_content: false,
  request_id: null,
  secrets: [],
  connection: 'graph-connection',
  provider: null,
};

function mcpOf(fake: FakeMcpServer): McpServerSettings {
  return { ...servedBy, type: 'mcp', url: fake.url, auth: secretAuth(fake) };
}

function apiOf(fake: FakeMcpServer, document: ApiDocumentSource, baseUrl: string | null): OpenApiServerSettings {
  return {
    ...servedBy,
    type: 'openapi',
    document,
    base_url: baseUrl,
    query_params: new Map(),
    security: new Map(),
    path_values: new Map(),
    auth: secretAuth(fake),
    failure_codes: null,
  };
}

const shippedApi: ApiDocumentSource = {
  kind: 'shipped',
  document: shippedDocumentOf(new TextEncoder().encode(JSON.stringify(fakeApiDocument('3.1', theApi)))),
};

function recordingFetch() {
  const asked: string[] = [];
  const fetch: FetchLike = (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    asked.push(request.url);
    return new URL(request.url).hostname.endsWith('.in-process.test')
      ? inProcessFetch(request)
      : Promise.resolve(new Response(null, { status: 404 }));
  };
  return { fetch, asked: () => [...asked] };
}

function unreachable(): Promise<Response> {
  return Promise.reject(new TypeError('fetch failed'));
}

describe('the check of the client credentials of a connection', () => {
  it('is taken where the issuer answers a token, or refused with its code where it refuses the secret', async () => {
    const answering = issuerOf();
    const refusing = issuerOf('another-secret');

    const checked = await Promise.all(
      [answering, refusing].map((fake) =>
        connectionTokensCheckedOf(mcpOf(fake), { fetch: inProcessFetch, now: atTheMoment }),
      ),
    );

    expect(checked).toEqual([{ kind: 'taken' }, { kind: 'refused', code: 'invalid_client' }]);
    expect(answering.tokenRequests()).toBe(1);
  });

  it('is unreached, at the hosts it asked, where the issuer cannot be reached', async () => {
    const fake = issuerOf();

    expect(await connectionTokensCheckedOf(mcpOf(fake), { fetch: unreachable, now: atTheMoment })).toEqual({
      kind: 'unreached',
      hosts: [new URL(fake.origin).hostname],
    });
  });
});

describe('the check of the client credentials of a connection to an HTTP API', () => {
  it('asks for the resource the API protects at the base URL of the settings, reading no document', async () => {
    const fake = issuerOf();
    const asking = recordingFetch();
    const unread: ApiDocumentSource = { kind: 'url', url: 'https://docs.example.com/openapi.json' };

    const checked = await connectionTokensCheckedOf(apiOf(fake, unread, theApi), { ...asking, now: atTheMoment });

    expect(checked).toEqual({ kind: 'taken' });
    expect(asking.asked()).toContain('https://api.example.com/.well-known/oauth-protected-resource/v1');
    expect(asking.asked()).not.toContain(unread.url);
  });

  it('asks at the server its document names where the settings name no base URL', async () => {
    const fake = issuerOf();
    const asking = recordingFetch();

    const checked = await connectionTokensCheckedOf(apiOf(fake, shippedApi, null), { ...asking, now: atTheMoment });

    expect(checked).toEqual({ kind: 'taken' });
    expect(asking.asked()).toContain('https://api.example.com/.well-known/oauth-protected-resource/v1');
  });

  it('answers that its document cannot be read now, or cannot be read, asking no token', async () => {
    const fake = issuerOf();
    const missing: ApiDocumentSource = { kind: 'url', url: 'https://docs.example.com/openapi.json' };
    const notADocument: ApiDocumentSource = {
      kind: 'shipped',
      document: shippedDocumentOf(new TextEncoder().encode('{}')),
    };
    const asking = recordingFetch();

    const checked = await Promise.all(
      [missing, notADocument].map((document) =>
        connectionTokensCheckedOf(apiOf(fake, document, null), { ...asking, now: atTheMoment }),
      ),
    );

    expect(checked).toMatchObject([{ kind: 'document_unread' }, { kind: 'document_refused' }]);
    expect(fake.tokenRequests()).toBe(0);
  });
});
