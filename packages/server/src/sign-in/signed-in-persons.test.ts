import { signInScopes, studioOrigin } from '@on.auto/identity';
import { approvalDocument } from '@on.auto/interaction/testing';
import { describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { brief, interactionServerOn } from '../testing/interaction-servers/interaction-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn } from '../testing/servers/workflow-server.ts';
import { accessTokenOf, issuerOverHttps } from './issuer-over-https.ts';

const publicUrl = 'http://localhost:5555';

const rootMetadata = `${publicUrl}/.well-known/oauth-protected-resource`;

function signingIn(issuer: string): Readonly<Record<string, string>> {
  return { IDENTITY_ISSUER: issuer, PUBLIC_URL: publicUrl };
}

describe('a signed-in person on the facts', () => {
  it('is named person:<subject> as who created the playbook and the definition, started the run and answered it', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn(signingIn(issuer.issuer));
    const key = await accessTokenOf(issuer, publicUrl, signInScopes.join(' '));

    const playbook = await server.call('POST', '/v1/orgs/acme/playbooks', {
      key,
      body: { playbook: 'alpha', name: 'Alpha' },
    });
    const definition = await server.call('POST', `${alpha}/definitions/interaction`, {
      key,
      body: { name: 'approve-brief', source: approvalDocument() },
    });
    const started = await server.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
      key,
      body: { input: brief },
    });
    const runId = runIdIn(started.body);
    const answered = await server.call('POST', `${alpha}/runs/${runId}/answer`, {
      key,
      body: { answer: { choice: 'approve' } },
    });
    const run = await server.call('GET', `${alpha}/runs/${runId}`, { key });

    expect([playbook.body, definition.body, run.body, answered.body]).toMatchObject([
      { created_by: 'person:user|ada' },
      { created_by: 'person:user|ada' },
      { started_by: 'person:user|ada' },
      { answered_by: 'person:user|ada' },
    ]);
  });
});

describe('a server that signs persons in', () => {
  it('serves the protected resource metadata without a key, naming the identity service as its authorization server', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn(signingIn(issuer.issuer));

    const metadata = await server.call('GET', '/.well-known/oauth-protected-resource/mcp');
    const unauthenticated = await server.call('GET', '/v1/orgs/acme/playbooks');

    expect(metadata).toMatchObject({
      status: 200,
      body: { resource: `${publicUrl}/mcp`, authorization_servers: [issuer.issuer] },
    });
    expect(metadata.body).toMatchObject({ scopes_supported: signInScopes });
    expect(unauthenticated.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${rootMetadata}", scope="user:org:read org:read org:write playbook:read playbook:write"`,
    );
  });

  it('does not start when the identity service cannot be read, naming it', async () => {
    const ledger = temporaryLedger();

    const failure = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LEDGER_FILE: ledger.fileName,
        PREDICTION_CACHE_DIR: ledger.cacheDirectory,
        ...signingIn('https://127.0.0.1:9'),
      },
      compositionRoot,
    ).catch((error: unknown) => error);
    ledger.remove();

    expect(failure).toMatchObject({ name: 'UnusableIdentityServiceError' });
    expect(String(failure)).toMatch(
      /^UnusableIdentityServiceError: The identity service at https:\/\/127\.0\.0\.1:9 cannot be used: no metadata of https:\/\/127\.0\.0\.1:9 could be used: /u,
    );
  });
});

describe('the permissions of a signed-in person', () => {
  it('are the permissions among the scopes their token was granted, a refusal naming what it needs', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn(signingIn(issuer.issuer));
    const reader = await accessTokenOf(issuer, publicUrl, 'user:org:read org:read playbook:read');
    const noPermission = await accessTokenOf(issuer, publicUrl, 'user:org:read');

    const listed = await server.call('GET', '/v1/orgs/acme/playbooks', { key: reader });
    const created = await server.call('POST', '/v1/orgs/acme/playbooks', {
      key: reader,
      body: { playbook: 'alpha', name: 'Alpha' },
    });
    const refused = await server.call('GET', '/v1/orgs/acme/playbooks', { key: noPermission });

    expect([listed.status, created.status, refused.status]).toEqual([200, 403, 403]);
    expect([created, refused].map(({ headers }) => headers.get('www-authenticate'))).toEqual([
      `Bearer error="insufficient_scope", scope="org:write", resource_metadata="${rootMetadata}"`,
      `Bearer error="insufficient_scope", scope="org:read playbook:read", resource_metadata="${rootMetadata}"`,
    ]);
  });
});

const allowedPage = 'https://app.example';

const aKeyNoListHolds = `abk_acme-admin_${'A'.repeat(43)}`;

function createdWith(server: string, session: string, presentedFrom: string | undefined): Promise<Response> {
  return fetch(`${server}/v1/orgs/acme/playbooks`, {
    method: 'POST',
    headers: {
      ...(presentedFrom === undefined ? {} : { origin: presentedFrom }),
      authorization: `Bearer ${session}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ playbook: 'alpha', name: 'Alpha' }),
  });
}

describe('a page signed in to Auto, calling a server that signs persons in', () => {
  it.each([
    ['the studio', studioOrigin],
    ['an origin of ALLOWED_ORIGINS', allowedPage],
  ])('is served from %s with the session the identity service gave it, as the person', async (_case, page) => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn({ ...signingIn(issuer.issuer), ALLOWED_ORIGINS: allowedPage });
    const session = await issuer.session(page, { sub: 'user|ada' });

    const created = await createdWith(server.origin, session, page);

    expect([created.status, created.headers.get('access-control-allow-origin')]).toEqual([201, page]);
    expect(await created.json()).toMatchObject({ created_by: 'person:user|ada' });
  });

  it('refuses the session another page was given, naming its azp claim', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn(signingIn(issuer.issuer));
    const session = await issuer.session('https://elsewhere.example', { sub: 'user|ada' });

    const refused = await createdWith(server.origin, session, studioOrigin);

    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({
      detail: 'The token was refused: ERR_JWT_CLAIM_VALIDATION_FAILED on its azp claim',
    });
  });

  it.each([
    ['from another origin the server allows', allowedPage],
    ['without an Origin header, as an agent sends it', undefined],
  ])('refuses the session of the studio presented %s, naming no value', async (_case, presentedFrom) => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn({ ...signingIn(issuer.issuer), ALLOWED_ORIGINS: allowedPage });
    const session = await issuer.session(studioOrigin, { sub: 'user|ada' });

    const refused = await createdWith(server.origin, session, presentedFrom);

    expect([refused.status, await refused.json()]).toMatchObject([
      401,
      { detail: 'The token was refused: the session was not presented by the page it was issued to' },
    ]);
  });
});

describe('a server in local mode', () => {
  it('takes a page that sends its session, and a key where no key is set, as the local developer', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn({});
    const session = await issuer.session(studioOrigin, { sub: 'user|ada' });

    const fromThePage = await createdWith(server.origin, session, studioOrigin);
    const withAKey = await server.call('POST', '/v1/orgs/acme/playbooks', {
      key: aKeyNoListHolds,
      body: { playbook: 'beta', name: 'Beta' },
    });

    expect([fromThePage.status, await fromThePage.json()]).toMatchObject([201, { created_by: 'local' }]);
    expect(withAKey).toMatchObject({ status: 201, body: { created_by: 'local' } });
  });
});

describe('the documents of a server that signs persons in', () => {
  it('names PUBLIC_URL in its API catalog, not the address the request reached', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn(signingIn(issuer.issuer));

    const catalog = await server.call('GET', '/.well-known/api-catalog');

    expect(catalog).toMatchObject({
      status: 200,
      body: { linkset: [{ anchor: `${publicUrl}/.well-known/api-catalog` }, { anchor: `${publicUrl}/v1` }] },
    });
  });

  it('names the OpenID Connect metadata of the issuer IDENTITY_ISSUER names in its OpenAPI document', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn(signingIn(issuer.issuer));

    const document = await server.call('GET', '/v1/openapi.json');

    expect(document).toMatchObject({
      status: 200,
      body: {
        components: {
          securitySchemes: {
            openIdConnect: { openIdConnectUrl: `${issuer.issuer}/.well-known/openid-configuration` },
          },
        },
      },
    });
  });
});
