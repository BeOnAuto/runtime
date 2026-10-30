import { defaultStudioOrigin } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { jsonOf, postMcp } from '../testing/mcp-requests.ts';
import { allowedOrigin, signedInServer } from '../testing/signed-in.ts';

const asJson = { 'content-type': 'application/json' };

describe('a page at an allowed origin, sending the session the identity service gave it', () => {
  it.each([
    ['the studio', defaultStudioOrigin],
    ['an origin of ALLOWED_ORIGINS', allowedOrigin],
  ])(
    'acts at %s as the signed-in person, with every permission in their org, over every playbook',
    async (_case, page) => {
      const { server, fromPage } = await signedInServer();
      const headers = await fromPage(page, { o: { id: 'globex' } });

      const labelled = await call(server.handler, '/v1/orgs/globex/playbooks/gamma/label', {
        method: 'PUT',
        headers: { ...headers, ...asJson },
        body: '{"label":"from the page"}',
      });
      const noted = await call(server.handler, '/v1/orgs/globex/playbooks/gamma/notes', {
        method: 'POST',
        headers: { ...headers, ...asJson },
        body: '{"name":"a","text":"b"}',
      });
      const labels = await call(server.handler, '/v1/orgs/globex/playbook-labels', { headers });

      expect([labelled.status, noted.status, labels.status]).toEqual([200, 201, 200]);
      expect(labels.body).toEqual({ labels: [{ playbook: 'gamma', label: 'from the page' }] });
      expect(labels.headers.get('access-control-allow-origin')).toBe(page);
    },
  );

  it('acts in the org of its subject when the session names no org, and is refused every other with 403', async () => {
    const { server, fromPage } = await signedInServer();
    const headers = await fromPage(defaultStudioOrigin, { o: undefined, sub: 'user_2ada' });

    expect([
      (await call(server.handler, '/v1/orgs/user_2ada/playbook-labels', { headers })).status,
      (await call(server.handler, '/v1/orgs/acme/playbook-labels', { headers })).status,
    ]).toEqual([200, 403]);
  });

  it('is refused every other org with 403', async () => {
    const { server, fromPage } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/globex/playbook-labels', {
      headers: await fromPage(defaultStudioOrigin),
    });

    expect(answer).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  });
});

describe('a session the runtime refuses', () => {
  it('is answered 401 invalid_token, naming the azp claim, when another page was given it', async () => {
    const { server, fromPage } = await signedInServer();
    const { authorization = '' } = await fromPage('https://elsewhere.example');

    const answer = await call(server.handler, '/v1/orgs/acme/playbook-labels', {
      headers: { origin: defaultStudioOrigin, authorization },
    });

    expect(answer).toMatchObject({
      status: 401,
      body: {
        reason: 'unauthenticated',
        detail: 'The token was refused: ERR_JWT_CLAIM_VALIDATION_FAILED on its azp claim',
      },
    });
    expect(answer.headers.get('www-authenticate')).toMatch(/^Bearer error="invalid_token", /u);
  });

  it('is answered 401 for a session that names its org in org_id, not o, naming the o claim', async () => {
    const { server, fromPage } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbook-labels', {
      headers: await fromPage(defaultStudioOrigin, { o: undefined, org_id: 'acme' }),
    });

    expect(answer).toMatchObject({
      status: 401,
      body: { detail: 'The token was refused: ERR_JWT_CLAIM_VALIDATION_FAILED on its o claim' },
    });
  });

  it('never reaches the check of its token from a page at an origin the runtime does not allow', async () => {
    const { server, fromPage } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbook-labels', {
      headers: await fromPage('https://elsewhere.example'),
    });

    expect(answer).toMatchObject({ status: 403, body: { reason: 'origin_not_allowed' } });
  });
});

const notItsPage = 'The token was refused: the session was not presented by the page it was issued to';

const presentedElsewhere: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['without an Origin header', {}],
  ['from another origin the runtime allows', { origin: allowedOrigin }],
];

describe('a session presented by any other than its own page', () => {
  it.each(presentedElsewhere)('is answered 401 invalid_token over HTTP %s, naming no value', async (_case, origin) => {
    const { server, fromPage } = await signedInServer();
    const { authorization = '' } = await fromPage(defaultStudioOrigin);

    const answer = await call(server.handler, '/v1/orgs/acme/playbook-labels', {
      headers: { ...origin, authorization },
    });

    expect(answer).toMatchObject({ status: 401, body: { reason: 'unauthenticated', detail: notItsPage } });
    expect(answer.headers.get('www-authenticate')).toMatch(/^Bearer error="invalid_token", /u);
  });

  it('serves its page on an MCP endpoint, and is refused there to a client that sends no Origin, as an agent', async () => {
    const { server, fromPage } = await signedInServer();
    const { authorization = '' } = await fromPage(defaultStudioOrigin);

    const fromThePage = await postMcp(server.handler, '/mcp', { origin: defaultStudioOrigin, authorization });
    const fromAnAgent = await postMcp(server.handler, '/mcp', { authorization });

    expect([fromThePage.status, fromAnAgent.status]).toEqual([200, 401]);
    expect(jsonOf(fromAnAgent.text)).toMatchObject({ detail: notItsPage });
  });
});
