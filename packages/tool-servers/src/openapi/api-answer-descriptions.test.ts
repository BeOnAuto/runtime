import { Effect, type Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { documentOf, toolsOf } from '../api-testing/derived-documents.ts';
import { describedAccess } from '../testing/index.ts';
import { serveFakeApi } from '../testing/served-fakes.ts';
import { settledOf } from './api-answers.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function answersOf(...tools: readonly string[]): Promise<readonly unknown[]> {
  const fake = await serveFakeApi();
  closing.push(fake.close);
  const { access } = await describedAccess({ graph: { org: 'acme', document: fake.documentUrl } });
  closing.push(access.close);
  return Promise.all(
    tools.map(async (tool) => {
      const called = await Effect.runPromise(
        access.callOnce({ org: 'acme', playbook: 'alpha', reference: { server: 'graph', tool }, input: {}, meta: {} }),
      );
      return 'answer' in called ? called.answer : called;
    }),
  );
}

describe('the headers of an answer of an HTTP API', () => {
  it('are carried beside its body where the operation describes them, named as the document names them, and only those', async () => {
    const answers = await answersOf('saveNote', 'addNote', 'notes');

    expect(answers).toEqual([
      {
        content: [{ type: 'text', text: '{"headers":{"X-Note-Id":"note-1"},"body":{"saved":true}}' }],
        structuredContent: { headers: { 'X-Note-Id': 'note-1' }, body: { saved: true } },
      },
      {
        content: [{ type: 'text', text: '{"headers":{"X-Note-Id":"note-1"}}' }],
        structuredContent: { headers: { 'X-Note-Id': 'note-1' } },
      },
      { content: [] },
    ]);
  });
});

describe('the answers of an operation of an HTTP API', () => {
  it('are the JSON schemas of its successful responses, followed where a response refers to one, translated as its inputs are, and the headers each describes, none for a status that describes none or whose reference leads nowhere', () => {
    const text = { schema: { type: 'string' } };
    const responses = {
      '200': {
        content: {
          'application/json; charset=utf-8': { schema: { $ref: '#/components/schemas/Message' } },
          'text/plain': { schema: { type: 'string' } },
          'application/json+other': {},
        },
      },
      '2XX': { $ref: '#/components/responses/Listed' },
      '201': { $ref: '#/components/responses/Absent' },
      '204': { headers: { 'X-Deleted': text } },
      '404': { headers: { 'X-Missing': text }, content: { 'application/json': { schema: { type: 'object' } } } },
      default: { content: { 'application/json': { schema: { type: 'object' } } } },
    };
    const listed = { type: 'array', items: { $ref: '#/components/schemas/Message' } };
    const components = {
      schemas: { Message: { type: 'object', properties: { raw: { type: 'string', format: 'byte', nullable: true } } } },
      responses: { Listed: { headers: { Link: text }, content: { 'application/problem+json': { schema: listed } } } },
    };
    const document = {
      ...documentOf({ '/messages/{id}': { get: { operationId: 'getMessage', responses } } }, { components }),
      openapi: '3.0.3',
    };

    const [operation] = toolsOf(document).operations;

    expect(operation?.answers).toEqual({
      schemas: [{ $ref: '#/$defs/Message' }, { type: 'array', items: { $ref: '#/$defs/Message' } }],
      components: { Message: { type: 'object', properties: { raw: { type: ['string', 'null'], format: 'byte' } } } },
      headers: { '200': [], '201': [], '204': ['X-Deleted'], '2XX': ['Link'] },
    });
  });
});

const described = { schema: { type: 'string' } };

function answersDescribing(responses: Schema.JsonObject) {
  const document = documentOf({ '/notes': { post: { operationId: 'addNote', responses } } });
  const [operation] = toolsOf(document).operations;
  return operation?.answers;
}

const answering = { requestIdHeader: 'x-request-id', now: () => 0 };

async function answeredWith(response: Readonly<Response>, responses: Schema.JsonObject) {
  const settled = await settledOf(response, answering, answersDescribing(responses));
  return 'result' in settled ? settled.result : settled;
}

const guarded = ['Set-Cookie', 'Authorization', 'Proxy-Authenticate', 'WWW-Authenticate', 'Content-Type'];

describe('the headers an answer carries', () => {
  it('are never a cookie, a credential, a challenge or the media type, whatever the document describes', async () => {
    const responses = { '200': { headers: Object.fromEntries([...guarded, 'X-Id'].map((name) => [name, described])) } };
    const answer = Response.json(
      { saved: true },
      {
        headers: {
          'set-cookie': 'session=vendor-session',
          authorization: 'Bearer vendor-token',
          'proxy-authenticate': 'Basic',
          'www-authenticate': 'Bearer',
          'x-id': 'id-1',
        },
      },
    );

    expect(answersDescribing(responses)?.headers).toEqual({ '200': ['X-Id'] });
    expect(await answeredWith(answer, responses)).toEqual({
      content: [{ type: 'text', text: '{"headers":{"X-Id":"id-1"},"body":{"saved":true}}' }],
      structuredContent: { headers: { 'X-Id': 'id-1' }, body: { saved: true } },
    });
  });

  it('leave out a name that is no header name, and the call still answers', async () => {
    const responses = { '200': { headers: { 'X Id': described } } };

    expect(answersDescribing(responses)?.headers).toEqual({ '200': [] });
    expect(
      await answeredWith(Response.json({ saved: true }, { headers: { 'x-request-id': 'request-1' } }), responses),
    ).toEqual({ content: [{ type: 'text', text: '{"saved":true}' }], structuredContent: { saved: true } });
  });
});

describe('the headers of the status an answer has', () => {
  it('are those of the exact status before those of its range, none where the exact status describes none or leads nowhere', async () => {
    const ranged = { '2XX': { headers: { 'X-Id': described } } };
    const carrying = { headers: { 'x-id': 'id-1' } };

    const answers = await Promise.all([
      answeredWith(new Response(null, { status: 201, ...carrying }), { ...ranged, '201': { description: 'Added.' } }),
      answeredWith(new Response(null, { status: 201, ...carrying }), {
        ...ranged,
        '201': { $ref: '#/components/responses/Absent' },
      }),
      answeredWith(new Response(null, { status: 202, ...carrying }), ranged),
    ]);

    expect(answers).toEqual([
      { content: [] },
      { content: [] },
      {
        content: [{ type: 'text', text: '{"headers":{"X-Id":"id-1"}}' }],
        structuredContent: { headers: { 'X-Id': 'id-1' } },
      },
    ]);
  });

  it('stand alone beside a JSON null, which is no body', async () => {
    const responses = { '200': { headers: { 'X-Id': described } } };

    expect(await answeredWith(Response.json(null, { headers: { 'x-id': 'id-1' } }), responses)).toEqual({
      content: [{ type: 'text', text: '{"headers":{"X-Id":"id-1"}}' }],
      structuredContent: { headers: { 'X-Id': 'id-1' } },
    });
  });
});
