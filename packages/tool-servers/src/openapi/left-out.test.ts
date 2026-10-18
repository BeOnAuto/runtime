import { describe, expect, it } from 'vitest';

import { documentOf, keyPresented, toolNamed, toolsOf } from '../api-testing/derived-documents.ts';
import { fakeApiDocument } from '../testing/index.ts';

describe('an operation of an HTTP API that no tool is offered for', () => {
  it('needs a header, an object in its query or a body of another media type, and the reason is given', () => {
    expect(toolsOf(fakeApiDocument('3.1', '/v1')).leftOut).toEqual([
      {
        operation: 'sessionState (GET /sessions)',
        because: 'it needs the header X-Session, which a function cannot send; the headers of the entry can give it',
      },
      {
        operation: 'filtered (GET /filtered)',
        because: 'its query parameter filter is an object, which a call does not send in a query',
      },
      {
        operation: 'upload (POST /uploads)',
        because: 'its body is application/xml, and a call sends a body only as JSON',
      },
    ]);
  });

  it('needs a cookie, a query of objects that may be null, or two inputs of one name', () => {
    const { leftOut } = toolsOf(
      documentOf({
        '/a': { get: { parameters: [{ name: 'session', in: 'cookie', required: true }] } },
        '/b': { get: { parameters: [{ name: 'f', in: 'query', schema: { type: ['object', 'null'] } }] } },
        '/c/{id}': {
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true },
              { name: 'id', in: 'query' },
            ],
          },
          post: { parameters: [{ name: 'body', in: 'query' }], requestBody: { content: { 'application/json': {} } } },
        },
      }),
    );

    expect(leftOut).toEqual([
      { operation: 'GET /a', because: 'it needs the cookie session, which a function cannot send' },
      { operation: 'GET /b', because: 'its query parameter f is an object, which a call does not send in a query' },
      { operation: 'GET /c/{id}', because: 'two of its inputs are named id' },
      { operation: 'POST /c/{id}', because: 'two of its inputs are named body' },
    ]);
  });
});

describe('an operation of an HTTP API that needs a header', () => {
  it('is offered when the headers of its entry name each header it needs, in any case, which is then no input', () => {
    const required = { in: 'header', required: true, schema: { type: 'string' } };
    const { operations, leftOut } = toolsOf(
      documentOf({
        '/a': {
          get: {
            parameters: [
              { name: 'X-Client-Id', ...required },
              { name: 'q', in: 'query' },
            ],
          },
        },
        '/b': {
          get: {
            parameters: [
              { name: 'X-Client-Id', ...required },
              { name: 'X-Account', ...required },
            ],
          },
        },
        '/c': {
          get: {
            parameters: [
              { name: 'x-client-id', ...required },
              { name: 'session', in: 'cookie', required: true },
            ],
          },
        },
      }),
      { ...keyPresented, headers: new Set(['x-client-id']) },
    );

    expect(operations.map(({ tool, inputs }) => [tool.name, tool.inputSchema['properties'], inputs])).toEqual([
      ['get_a', { q: {} }, [{ name: 'q', in: 'query', joinsLists: false }]],
    ]);
    expect(leftOut).toEqual([
      {
        operation: 'GET /b',
        because: 'it needs the header X-Account, which a function cannot send; the headers of the entry can give it',
      },
      { operation: 'GET /c', because: 'it needs the cookie session, which a function cannot send' },
    ]);
  });
});

describe('a header parameter of an HTTP API that the OpenAPI specification says to ignore', () => {
  it('is Accept, Content-Type or Authorization in any case, never needed and never named in a refusal', () => {
    const required = { in: 'header', required: true, schema: { type: 'string' } };
    const { operations, leftOut } = toolsOf(
      documentOf({
        '/a': {
          get: {
            parameters: [
              { name: 'Accept', ...required },
              { name: 'content-type', ...required },
              { name: 'AUTHORIZATION', ...required },
            ],
          },
        },
      }),
    );

    expect(operations.map(({ tool, inputs }) => [tool.name, inputs])).toEqual([['get_a', []]]);
    expect(leftOut).toEqual([]);
  });

  it('is Host or Content-Length, which the runtime sets itself, said so where it leaves its operation out', () => {
    const required = { in: 'header', required: true };
    const { leftOut } = toolsOf(
      documentOf({
        '/a': { get: { parameters: [{ name: 'Host', ...required }] } },
        '/b': { get: { parameters: [{ name: 'content-length', ...required }] } },
      }),
    );

    expect(leftOut.map(({ because }) => because)).toEqual([
      'it needs the header Host, which the runtime sets itself and neither a function nor the headers of the entry can give',
      'it needs the header content-length, which the runtime sets itself and neither a function nor the headers of the entry can give',
    ]);
  });
});

const listed = { name: 'tags', schema: { type: 'array', items: { type: 'string' } } };

const scalar = { name: 'state', schema: { type: 'string', enum: ['open', 'closed'] } };

describe('an operation of an HTTP API that a call could only send in another form, or not at all', () => {
  it('is TRACE, which fetch refuses, or a GET or HEAD that takes a body', () => {
    const json = { requestBody: { content: { 'application/json': {} } } };
    const { leftOut } = toolsOf(documentOf({ '/a': { trace: {}, get: json, head: json, post: json } }));

    expect(leftOut).toEqual([
      { operation: 'GET /a', because: 'it takes a body, which a GET cannot carry' },
      { operation: 'HEAD /a', because: 'it takes a body, which a HEAD cannot carry' },
      { operation: 'TRACE /a', because: 'a call cannot send TRACE, which fetch refuses' },
    ]);
  });

  it('writes a path parameter in a style other than simple, which is the style a call sends a path in', () => {
    const { operations, leftOut } = toolsOf(
      documentOf({
        '/a/{id}': {
          get: { parameters: [{ name: 'id', in: 'path', required: true, style: 'label' }] },
          put: { parameters: [{ name: 'id', in: 'path', required: true, style: 'simple', explode: true }] },
          delete: { parameters: [{ name: 'X-Trace', in: 'header', style: 'simple', explode: true }] },
        },
      }),
    );

    expect(operations.map(({ tool }) => tool.name)).toEqual(['put_a_id', 'delete_a_id']);
    expect(leftOut).toEqual([
      {
        operation: 'GET /a/{id}',
        because: 'its path parameter id is written with style label, a form a call does not send',
      },
    ]);
  });
});

describe('a query parameter of an HTTP API, by the style its document writes it in', () => {
  it('leaves its operation out as spaceDelimited, pipeDelimited or deepObject, whatever its schema', () => {
    const { operations, leftOut } = toolsOf(
      documentOf({
        '/b': {
          get: { parameters: [{ ...listed, in: 'query', style: 'form', explode: true }] },
          put: { parameters: [{ ...listed, in: 'query', style: 'pipeDelimited' }] },
          post: { parameters: [{ ...listed, in: 'query', style: 'spaceDelimited', explode: false }] },
          patch: { parameters: [{ ...scalar, in: 'query', style: 'deepObject' }] },
        },
      }),
    );

    expect(operations.map(({ tool }) => tool.name)).toEqual(['get_b']);
    expect(leftOut.map(({ operation, because }) => `${operation}: ${because}`)).toEqual([
      'PUT /b: its query parameter tags is written with style pipeDelimited, a form a call does not send',
      'POST /b: its query parameter tags is written with style spaceDelimited, a form a call does not send',
      'PATCH /b: its query parameter state is written with style deepObject, a form a call does not send',
    ]);
  });
});

describe('a query parameter of an HTTP API that its document writes as form with explode false', () => {
  it('is offered, a scalar sent as written and a list joined by commas, but not an object', () => {
    const unexploded = { in: 'query', style: 'form', explode: false };
    const filter = { name: 'f', ...unexploded, schema: { $ref: '#/components/schemas/Filter' } };
    const { operations, leftOut } = toolsOf(
      documentOf(
        {
          '/b': {
            get: {
              parameters: [
                { ...listed, ...unexploded },
                { ...scalar, ...unexploded },
              ],
            },
            put: { parameters: [{ name: 'count', in: 'query', explode: false, schema: { type: 'integer' } }] },
            post: { parameters: [filter] },
          },
        },
        { components: { schemas: { Filter: { type: 'object' } } } },
      ),
    );

    expect(operations.map(({ tool, inputs }) => [tool.name, inputs])).toEqual([
      [
        'get_b',
        [
          { name: 'tags', in: 'query', joinsLists: true },
          { name: 'state', in: 'query', joinsLists: true },
        ],
      ],
      ['put_b', [{ name: 'count', in: 'query', joinsLists: true }]],
    ]);
    expect(leftOut).toEqual([
      { operation: 'POST /b', because: 'its query parameter f is an object, which a call does not send in a query' },
    ]);
  });
});

describe('the tools of an HTTP API, in documents of other shapes', () => {
  it('are none for a document of no paths', () => {
    expect(toolsOf({ openapi: '3.1.0' })).toEqual({ operations: [], leftOut: [] });
  });

  it('hold a component once under $defs however often their inputs refer to it, and follow a loop of components', () => {
    const day = { $ref: '#/components/schemas/Day' };
    const parameters = [
      { name: 'from', in: 'query', schema: day },
      { name: 'to', in: 'query', schema: day },
      { name: 'next', in: 'query', schema: { $ref: '#/components/schemas/Ping' } },
    ];
    const schemas = {
      Day: { type: 'string', format: 'date' },
      Ping: { $ref: '#/components/schemas/Pong' },
      Pong: { $ref: '#/components/schemas/Ping' },
    };

    const tool = toolNamed(
      documentOf({ '/a': { get: { operationId: 'a', parameters } } }, { components: { schemas } }),
      'a',
    );

    expect(tool?.inputSchema['$defs']).toEqual({
      Day: { type: 'string', format: 'date' },
      Ping: { $ref: '#/$defs/Pong' },
      Pong: { $ref: '#/$defs/Ping' },
    });
  });
});
