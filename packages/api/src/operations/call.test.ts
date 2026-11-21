import { defineQuery } from '@on.auto/operations';
import { Context, Effect, Option, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { findNotes } from '../testing/found-notes.ts';
import { listenInProcess, type Listening } from '../testing/listening.ts';
import { withMcpSession } from '../testing/mcp-clients.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, acmeReader, operationServer, type OperationServer } from '../testing/operation-server.ts';

class Invocation extends Context.Service<Invocation, string>()('test/Invocation') {}

const nameTheInvocation = defineQuery('playbook', {
  name: 'name_the_invocation',
  title: 'Name the invocation',
  description: 'Names the invocation that asks. Use it to learn which one did. It answers its name.',
  route: { method: 'GET', path: '/invocation' },
  inputSchema: Schema.Struct({
    about: Schema.optionalKey(Schema.String.annotate({ description: 'What it is asked about' })),
  }),
  outputSchema: Schema.Struct({ invocation: Schema.String }),
  reasons: [],
  handle: () =>
    Effect.serviceOption(Invocation).pipe(
      Effect.map(Option.getOrElse(() => 'none')),
      Effect.map((invocation) => ({ invocation })),
    ),
  plainLanguage: { task: 'name the invocation', attempt: () => 'name the invocation', outcome: () => 'Named.' },
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({
    operations: [...notebookOperations, nameTheInvocation],
    callContext: (request) => Context.make(Invocation, request.headers.get('x-invocation') ?? 'unnamed'),
  });
  listening = listenInProcess(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

const asked = { authorization: `Bearer ${acmeAdmin.key}`, 'x-invocation': 'invocation-7' };

describe('the context of a call', () => {
  it('reaches the operation a request over HTTP dispatches, made of the request', async () => {
    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/invocation', { headers: asked });

    expect([answer.status, answer.body]).toEqual([200, { invocation: 'invocation-7' }]);
  });

  it('reaches the operation a tool of the MCP endpoint dispatches, made of the request that called the tool', async () => {
    const result = await withMcpSession(
      'current revision',
      { url: `${listening.origin}/orgs/acme/playbooks/alpha/mcp`, headers: asked },
      (session) => session.callTool('name_the_invocation'),
    );

    expect(result.structuredContent).toEqual({ in_words: 'Named.', invocation: 'invocation-7' });
  });
});

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const jsonAsAdmin = { ...asAdmin, 'content-type': 'application/json' };

const notes = '/v1/orgs/acme/playbooks/alpha/notes';

const betaLabel = '/v1/orgs/acme/playbooks/beta/label';

const found = '/v1/orgs/acme/playbooks/alpha/notes/found';

const queryBesideABody =
  'An operation called by POST or PUT takes no query parameters; send its input in the JSON body';

describe('the input of a GET operation', () => {
  it('comes from the query string, decoded from strings', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, `${notes}?limit=1`, { headers: asAdmin })).toMatchObject({ status: 200 });
  });

  it.each([
    ['a value the schema cannot decode', `${notes}?limit=many`, '/limit'],
    ['an unknown field', `${notes}?colour=red`, '/colour'],
    ['a field named __proto__', `${notes}?__proto__=x`, '/__proto__'],
  ])('is rejected with 422 for %s, pointing at it', async (_case, path, pointer) => {
    const { handler } = await operationServer();

    expect(await call(handler, path, { headers: asAdmin })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer }] },
    });
  });

  it.each([
    ['in the query string twice', `${notes}?limit=1&limit=2`, 'limit'],
    ['in the path and the query string', `${notes}/first?name=other`, 'name'],
  ])('is rejected as a bad request for a field given %s', async (_case, path, field) => {
    const { handler } = await operationServer();

    expect(await call(handler, path, { headers: asAdmin })).toMatchObject({
      status: 400,
      body: { reason: 'bad_request', detail: `The field ${field} is given in more than one place` },
    });
  });
});

describe('the input of a POST or PUT operation', () => {
  it('merges the path parameters with the JSON body', async () => {
    const { handler } = await operationServer();

    expect(
      await call(handler, betaLabel, { method: 'PUT', headers: jsonAsAdmin, body: '{"label":"b"}' }),
    ).toMatchObject({
      status: 200,
      body: { playbook: 'beta', label: 'b' },
    });
  });

  it('rejects a field given in the path and in the body as a bad request', async () => {
    const { handler } = await operationServer();
    const body = '{"playbook":"alpha","label":"b"}';

    expect(await call(handler, betaLabel, { method: 'PUT', headers: jsonAsAdmin, body })).toMatchObject({
      status: 400,
      body: { reason: 'bad_request', detail: 'The field playbook is given in more than one place' },
    });
  });

  it.each([
    ['POST', `${notes}?name=first`, '{"name":"first","text":"t"}'],
    ['PUT', `${betaLabel}?label=b`, '{"label":"b"}'],
    ['PUT', `${betaLabel}?unrelated=1`, '{"label":"b"}'],
  ])('rejects any query parameter on %s %s as a bad request', async (method, path, body) => {
    const { handler } = await operationServer();

    expect(await call(handler, path, { method, headers: jsonAsAdmin, body })).toMatchObject({
      status: 400,
      body: { reason: 'bad_request', detail: queryBesideABody },
    });
  });

  it('is {} when the body is empty, whatever the content type', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, notes, { method: 'POST', headers: asAdmin })).toMatchObject({
      status: 422,
      body: { errors: [{ pointer: '/name' }, { pointer: '/text' }] },
    });
  });
});

describe('the input of a query routed by POST', () => {
  it('comes from the JSON body, which carries a list a query string cannot, for a key that may only read', async () => {
    const { handler } = await operationServer({ operations: [...notebookOperations, findNotes] });
    const asReader = { authorization: `Bearer ${acmeReader.key}`, 'content-type': 'application/json' };
    await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: '{"name":"first","text":"red sky"}' });

    const answered = await call(handler, found, { method: 'POST', headers: asReader, body: '{"words":["red","sky"]}' });

    expect(answered).toMatchObject({ status: 200, body: { notes: [{ name: 'first', text: 'red sky' }] } });
    expect(answered.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a query string beside the body, as every POST does', async () => {
    const { handler } = await operationServer({ operations: [...notebookOperations, findNotes] });

    expect(
      await call(handler, `${found}?words=red`, { method: 'POST', headers: jsonAsAdmin, body: '{"words":[]}' }),
    ).toMatchObject({ status: 400, body: { reason: 'bad_request', detail: queryBesideABody } });
  });
});
