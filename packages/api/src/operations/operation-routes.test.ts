import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { notebookOperationsAnnouncingWaits } from '../testing/notebook.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const jsonAsAdmin = { ...asAdmin, 'content-type': 'application/json' };

const notes = '/v1/orgs/acme/playbooks/alpha/notes';

const firstNote = '{"name":"first","text":"hello"}';

describe('a command or a query served over HTTP', () => {
  it('answers a command with its declared success status, its output as JSON and no caching', async () => {
    const { handler } = await operationServer();

    const answer = await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: firstNote });

    expect(answer).toMatchObject({ status: 201, body: { name: 'first', text: 'hello' } });
    expect(answer.headers.get('content-type')).toBe('application/json');
    expect(answer.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a query with 200 and reads what a command wrote', async () => {
    const { handler } = await operationServer();
    await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: firstNote });

    expect(await call(handler, notes, { headers: asAdmin })).toMatchObject({
      status: 200,
      body: { notes: [{ name: 'first', text: 'hello' }] },
    });
    expect(await call(handler, `${notes}/first`, { headers: asAdmin })).toMatchObject({ status: 200 });
  });

  it('serves an org-scoped operation under /v1/orgs/{org}', async () => {
    const { handler } = await operationServer();
    const betaLabel = '/v1/orgs/acme/playbooks/beta/label';
    await call(handler, betaLabel, { method: 'PUT', headers: jsonAsAdmin, body: '{"label":"first"}' });
    await call(handler, betaLabel, { method: 'PUT', headers: jsonAsAdmin, body: '{"label":"second"}' });

    expect(await call(handler, '/v1/orgs/acme/playbook-labels', { headers: asAdmin })).toMatchObject({
      status: 200,
      body: { labels: [{ playbook: 'beta', label: 'second' }] },
    });
  });
});

describe('the methods of an operation path', () => {
  it('include HEAD for a query', async () => {
    const { handler } = await operationServer();

    const head = await call(handler, notes, { method: 'HEAD', headers: asAdmin });

    expect({ status: head.status, text: head.text }).toEqual({ status: 200, text: '' });
  });

  it('are listed in Allow when a method no operation answers is rejected with 405', async () => {
    const { handler } = await operationServer();

    const rejected = await call(handler, notes, { method: 'DELETE', headers: asAdmin });

    expect(rejected).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
    expect(rejected.headers.get('allow')).toBe('GET, HEAD, POST');
  });
});

describe('a call that is rejected or fails', () => {
  it('answers a declared rejection with its problem document', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, `${notes}/missing`, { headers: asAdmin })).toMatchObject({
      status: 404,
      body: { reason: 'not_found', detail: 'There is no note missing' },
    });
  });

  it('carries the issues of invalid input as errors with pointers', async () => {
    const { handler } = await operationServer();
    const body = '{"name":"Bad Name"}';

    expect(await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/name' }, { pointer: '/text' }] },
    });
  });

  it('answers a conflict with 409', async () => {
    const { handler } = await operationServer();
    await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: firstNote });

    expect(await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: firstNote })).toMatchObject({
      status: 409,
      body: { reason: 'conflict', detail: 'A note named first exists' },
    });
  });

  it('answers a failure with a 500 problem identified by the urn:uuid of the incident it was reported under', async () => {
    const { handler, incidents } = await operationServer();

    const answer = await call(handler, '/v1/orgs/acme/playbooks/alpha/broken', { headers: asAdmin });

    expect(answer).toMatchObject({
      status: 500,
      body: { reason: 'internal', instance: `urn:uuid:${String(incidents()[0]?.id)}` },
    });
    expect(answer.body).not.toHaveProperty('incident');
    expect(answer.text).not.toContain('hunter2');
  });
});

describe('a handler that checks the input', () => {
  const lines = '/v1/orgs/acme/playbooks/alpha/lines';

  it('answers input it accepts', async () => {
    const { handler } = await operationServer();
    const body = JSON.stringify({ lines: ['Fine', 'Also fine'] });

    expect(await call(handler, lines, { method: 'POST', headers: jsonAsAdmin, body })).toMatchObject({
      status: 200,
      body: { accepted: 2 },
    });
  });

  it('has its issues carried as errors with pointers', async () => {
    const { handler } = await operationServer();
    const body = JSON.stringify({ lines: ['Fine', 'lower', 'Fine', 'also lower'] });

    const answer = await call(handler, lines, { method: 'POST', headers: jsonAsAdmin, body });

    expect(answer.status).toBe(422);
    expect(answer.body).toEqual({
      type: 'https://on.auto/problems/invalid_input',
      title: 'Invalid input',
      status: 422,
      detail: 'Some lines need fixing',
      reason: 'invalid_input',
      errors: [
        { detail: 'Line 2 must start with a capital letter', pointer: '/lines/1' },
        { detail: 'Line 4 must start with a capital letter', pointer: '/lines/3' },
      ],
    });
  });

  it('has at most 100 of its issues carried', async () => {
    const { handler } = await operationServer();
    const body = JSON.stringify({ lines: Array.from({ length: 150 }, () => 'lower') });

    const answer = await call(handler, lines, { method: 'POST', headers: jsonAsAdmin, body });

    expect(answer).toMatchObject({ status: 422, body: { reason: 'invalid_input' } });
    expect(answer.body).toHaveProperty('errors.length', 100);
  });
});

describe('a call that cannot run', () => {
  it('answers 503 once the runtime is disposed', async () => {
    const { handler, runtime } = await operationServer();
    await runtime.dispose();

    const answer = await call(handler, notes, { headers: asAdmin });

    expect(answer).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', type: 'https://on.auto/problems/unavailable', detail: 'The server is stopping' },
    });
    expect(answer.headers.get('retry-after')).toBe('5');
  });
});

describe('an ending that names its kind', () => {
  it('answers an ending with its kind and because, and asks for a retry only when a retry may resolve it', async () => {
    const { handler } = await operationServer();
    const sending = (kind: string) =>
      call(handler, `${notes}/sending`, { method: 'POST', headers: jsonAsAdmin, body: JSON.stringify({ kind }) });

    const unfinished = await sending('tools_unfinished');
    const failing = await sending('tool_server_failed');

    expect(unfinished).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: 'The notes could not be sent',
        kind: 'tools_unfinished',
        because: 'model_unavailable',
      },
    });
    expect(failing).toMatchObject({ status: 503, body: { kind: 'tool_server_failed', because: 'unreachable' } });
    expect([unfinished.headers.get('retry-after'), failing.headers.get('retry-after')]).toEqual([null, '5']);
  });

  it('answers a view still being built with its own problem type, no because, and a time to try again', async () => {
    const { handler } = await operationServer();

    const rebuilding = await call(handler, `${notes}/sending`, {
      method: 'POST',
      headers: jsonAsAdmin,
      body: JSON.stringify({ kind: 'rebuilding' }),
    });

    expect(rebuilding).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', type: 'https://on.auto/problems/rebuilding', kind: 'rebuilding' },
    });
    expect(rebuilding.body).not.toHaveProperty('because');
    expect(rebuilding.headers.get('retry-after')).toBe('5');
  });
});

describe('a call the client leaves', () => {
  it('is cancelled when the client goes away, and reports no incident', async () => {
    const waiting = Promise.withResolvers<void>();
    const { handler, incidents } = await operationServer({
      operations: notebookOperationsAnnouncingWaits(waiting.resolve),
    });
    const client = new AbortController();
    const request = new Request('http://localhost/v1/orgs/acme/playbooks/alpha/waiting', {
      headers: asAdmin,
      signal: client.signal,
    });

    const answering = handler.fetch(request);
    await waiting.promise;
    client.abort();
    const answer = await answering;

    expect({ status: answer.status, body: await answer.json() }).toMatchObject({
      status: 499,
      body: { reason: 'client_closed_request', detail: 'The client closed the request before it was answered' },
    });
    expect(incidents()).toEqual([]);
  });
});
