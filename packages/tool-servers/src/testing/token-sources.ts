import { generateKeyPairSync } from 'node:crypto';

import type { FetchLike } from '@modelcontextprotocol/client';
import type { FetchOfACall } from '@on.auto/operations';
import { Redacted } from 'effect';

import { secretsOf } from '../bounds/secrets.ts';
import { tokenSource, type Discovery, type UnauthorizedContext } from '../clients/token-source.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import type { MintingAuth } from '../settings/server-settings.ts';

export const clientSecret = 'graph-client-secret-81c2';

interface SourceReach {
  readonly discovery?: Discovery;
  readonly serverUrl?: string;
}

export function rsaKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

export function secretAuth(fake: FakeMcpServer, changes: Partial<MintingAuth> = {}): MintingAuth {
  return {
    issuer: fake.origin,
    client_id: 'playbook',
    scope: null,
    credential: { kind: 'client_secret', client_secret: Redacted.make(clientSecret) },
    ...changes,
  };
}

export function refusedAt(fake: FakeMcpServer, challenge = ''): UnauthorizedContext {
  const headers = new Headers(challenge === '' ? {} : { 'www-authenticate': challenge });
  return { response: new Response(null, { status: 401, headers }), serverUrl: new URL(fake.url), fetchFn: fetch };
}

export function askingFetch() {
  const urls: string[] = [];
  const bodies: Readonly<Record<string, string>>[] = [];
  const asking: FetchOfACall = async (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    urls.push(request.url);
    if (request.url.endsWith('/token')) {
      bodies.push(Object.fromEntries(new URLSearchParams(await request.clone().text())));
    }
    return globalThis.fetch(request);
  };
  return {
    fetch: asking,
    urls: () => [...urls],
    bodies: () => [...bodies],
    scopes: () => bodies.map((body) => body['scope'] ?? null),
  };
}

export function sourceOf(
  fake: FakeMcpServer,
  settings: MintingAuth,
  fetch: FetchLike = globalThis.fetch,
  { discovery = 'from_the_server', serverUrl = fake.url }: SourceReach = {},
) {
  const clock = { now: Date.parse('2026-10-05T09:00:00.000Z') };
  const minted: (readonly [string, string])[] = [];
  const secrets = secretsOf([]);
  const source = tokenSource(settings, {
    server: 'graph',
    serverUrl,
    discovery,
    fetch,
    now: () => clock.now,
    minted: (server, token) => {
      minted.push([server, token]);
      secrets.replace(server, token);
    },
  });
  return { source, clock, minted, secrets };
}
