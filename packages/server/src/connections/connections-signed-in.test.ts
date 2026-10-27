import { createApiKey, signInScopes } from '@on.auto/identity';
import type { FakeIssuer } from '@on.auto/identity/testing';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { accessTokenOf, issuerOverHttps } from '../sign-in/issuer-over-https.ts';
import { answerFieldsOf } from '../testing/servers/connected-servers.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const publicUrl = 'http://localhost:5555';

const connections = '/v1/orgs/acme/connections';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const notes = {
  name: 'notes',
  type: 'mcp',
  entry: { url: 'https://notes.example.com/mcp' },
  credential: { kind: 'none' },
};

const AddedSchema = Schema.Struct({ id: Schema.String, connect: Schema.Struct({ url: Schema.String }) });

const LinkSchema = Schema.Struct({ token: Schema.String, server: Schema.String });

function linkOf(url: string) {
  return Schema.decodeUnknownSync(LinkSchema)(Object.fromEntries(new URL(url).searchParams));
}

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
});

function tokenOfAnotherPerson(issuer: FakeIssuer): Promise<string> {
  const seconds = Math.floor(Date.now() / 1000);
  return issuer.sign({
    iss: issuer.issuer,
    sub: 'user|grace',
    name: 'Grace Hopper',
    aud: publicUrl,
    iat: seconds,
    exp: seconds + 300,
    org_id: 'acme',
    scope: signInScopes.join(' '),
  });
}

describe('a connection on a runtime that signs people in', () => {
  it('links to the page with PUBLIC_URL as the server, and is approved by the person who added it alone', async () => {
    const issuer = await issuerOverHttps();
    server = await servingReasoning([], { IDENTITY_ISSUER: issuer.issuer, PUBLIC_URL: publicUrl });
    const ada = await accessTokenOf(issuer, publicUrl, signInScopes.join(' '));
    const grace = await tokenOfAnotherPerson(issuer);

    const answer = await server.call('POST', connections, { key: ada, body: notes });
    const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(answer.body);
    const { token, server: named } = linkOf(connect.url);
    const byGrace = await server.call('POST', `${connections}/${id}/approve`, { key: grace, body: { token } });
    const byAda = await server.call('POST', `${connections}/${id}/approve`, { key: ada, body: { token } });

    expect(answer).toMatchObject({ status: 201, body: { added_by: { id: 'person:user|ada', name: 'Ada Lovelace' } } });
    expect(named).toBe(publicUrl);
    expect(byGrace).toMatchObject({
      status: 403,
      body: { detail: 'The connection notes was added by another person, and only they may approve it' },
    });
    expect(byAda).toMatchObject({ status: 200, body: { status: 'connected' } });
  });

  it('is refused to a key, since no person would approve it', async () => {
    const issuer = await issuerOverHttps();
    server = await servingReasoning([], {
      IDENTITY_ISSUER: issuer.issuer,
      PUBLIC_URL: publicUrl,
      API_KEYS: JSON.stringify([builder.entry]),
    });

    expect(await server.call('POST', connections, { key: builder.key, body: notes })).toMatchObject({
      status: 403,
      body: {
        detail:
          'A connection is added by a person, through an agent signed in as them, and a key cannot add or reconnect one',
      },
    });
  });
});

describe('a connection on a runtime of keys alone', () => {
  it('is refused, since the runtime signs in no person to approve it, and says what to set', async () => {
    server = await servingReasoning([], { API_KEYS: JSON.stringify([builder.entry]) });

    expect(await server.call('POST', connections, { key: builder.key, body: notes })).toMatchObject({
      status: 403,
      body: {
        detail:
          'This runtime signs nobody in, so no person can approve a connection: set PUBLIC_URL, or add the server to the configuration',
      },
    });
  });
});

describe('the providers the search of an org lists on a runtime that signs people in', () => {
  it('are left out for a key and for a person who may only read, and listed to a person who may add', async () => {
    const issuer = await issuerOverHttps();
    const served = await servingReasoning([], {
      IDENTITY_ISSUER: issuer.issuer,
      PUBLIC_URL: publicUrl,
      API_KEYS: JSON.stringify([builder.entry]),
    });
    server = served;
    const reader = await accessTokenOf(issuer, publicUrl, ['user:org:read', 'org:read'].join(' '));
    const adder = await accessTokenOf(issuer, publicUrl, signInScopes.join(' '));

    const answers = await Promise.all(
      [builder.key, reader, adder].map((key) => served.call('GET', '/v1/orgs/acme/tool-servers/search', { key })),
    );

    expect(answers.map(({ status, body }) => [status, answerFieldsOf(body)])).toEqual([
      [200, ['servers', 'tools', 'scopes']],
      [200, ['servers', 'tools', 'scopes']],
      [200, ['servers', 'tools', 'scopes', 'providers']],
    ]);
  });
});
