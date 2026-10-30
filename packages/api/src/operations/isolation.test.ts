import { authenticatorFor } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { call, type Call } from '../testing/api-calls.ts';
import { acmeAdmin, acmeAlphaWriter, acmeReader, globexAdmin, operationServer } from '../testing/operation-server.ts';

function as(key: string): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

const alphaNotes = '/v1/orgs/acme/playbooks/alpha/notes';

const lackingCalls: ReadonlyArray<readonly [string, string, Call]> = [
  [
    'a missing permission',
    alphaNotes,
    { method: 'POST', headers: as(acmeReader.key), body: '{"name":"a","text":"b"}' },
  ],
  ['a playbook the key may not access', '/v1/orgs/acme/playbooks/beta/notes', { headers: as(acmeAlphaWriter.key) }],
  ['another org', '/v1/orgs/globex/playbooks/gamma/notes', { headers: as(acmeAdmin.key) }],
];

describe('isolation between orgs over HTTP', () => {
  it('rejects a key of one org identically for an existing and a missing playbook of another org', async () => {
    const { handler } = await operationServer();

    const existing = await call(handler, '/v1/orgs/globex/playbooks/gamma/notes', { headers: as(acmeAdmin.key) });
    const missing = await call(handler, '/v1/orgs/globex/playbooks/nowhere/notes', { headers: as(acmeAdmin.key) });

    expect(existing).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(missing.text).toBe(existing.text);
    expect(
      await call(handler, '/v1/orgs/globex/playbooks/gamma/notes', { headers: as(globexAdmin.key) }),
    ).toMatchObject({
      status: 200,
    });
  });

  it('rejects a key of one org on an org-scoped operation of another org', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, '/v1/orgs/globex/playbook-labels', { headers: as(acmeAdmin.key) })).toMatchObject({
      status: 403,
    });
  });

  it('lets the local developer access any org', async () => {
    const { handler } = await operationServer({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
    });
    const local = { host: 'localhost:5555' };

    expect(await call(handler, '/v1/orgs/globex/playbooks/gamma/notes', { headers: local })).toMatchObject({
      status: 200,
    });
    expect(await call(handler, alphaNotes, { headers: local })).toMatchObject({ status: 200 });
  });
});

describe('isolation between playbooks and permissions over HTTP', () => {
  it('rejects a key limited to one playbook on another playbook of its own org', async () => {
    const { handler } = await operationServer();

    expect(
      await call(handler, '/v1/orgs/acme/playbooks/beta/notes', { headers: as(acmeAlphaWriter.key) }),
    ).toMatchObject({
      status: 403,
      body: { reason: 'forbidden' },
    });
    expect(await call(handler, alphaNotes, { headers: as(acmeAlphaWriter.key) })).toMatchObject({ status: 200 });
  });

  it('rejects a key limited to one playbook on an org operation that names another playbook', async () => {
    const { handler } = await operationServer();
    const labelBeta = { method: 'PUT', headers: as(acmeAlphaWriter.key), body: '{"label":"b"}' };

    expect(await call(handler, '/v1/orgs/acme/playbooks/beta/label', labelBeta)).toMatchObject({ status: 403 });
  });

  it('rejects a read-only key on a command, and serves it a query', async () => {
    const { handler } = await operationServer();
    const addNote = { method: 'POST', headers: as(acmeReader.key), body: '{"name":"a","text":"b"}' };

    expect(await call(handler, alphaNotes, addNote)).toMatchObject({
      status: 403,
      body: { detail: 'The caller lacks the playbook:write permission' },
    });
    expect(await call(handler, alphaNotes, { headers: as(acmeReader.key) })).toMatchObject({ status: 200 });
  });
});

describe('a key that lacks what a call needs', () => {
  it.each(lackingCalls)('is answered for %s with an insufficient_scope challenge', async (_case, path, request) => {
    const { handler } = await operationServer();

    const answer = await call(handler, path, request);

    expect(answer.status).toBe(403);
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="insufficient_scope"');
  });
});
