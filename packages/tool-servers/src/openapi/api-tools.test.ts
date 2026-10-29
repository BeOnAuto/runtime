import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf, problemsOf, toolNamed, toolsOf } from '../api-testing/derived-documents.ts';
import { fakeApiDocument } from '../testing/index.ts';

describe('the tools of an HTTP API', () => {
  it('are one for each operation, with the same names, schemas and hints from a document of 3.0 as of 3.1', () => {
    const of30 = toolsOf(fakeApiDocument('3.0', '/v1'));
    const of31 = toolsOf(fakeApiDocument('3.1', '/v1'));

    expect(of30.operations).toEqual(of31.operations);
    expect(of31.leftOut.map(({ operation }) => operation)).toEqual([
      'sessionState (GET /sessions)',
      'filtered (GET /filtered)',
      'upload (POST /uploads)',
    ]);
  });

  it('take a body and the parameters of a path and of a query, with the components they refer to under $defs', () => {
    expect(toolNamed(fakeApiDocument('3.0', '/v1'), 'updateProfile')).toEqual({
      name: 'updateProfile',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The id of the profile' }, body: { $ref: '#/$defs/Profile' } },
        required: ['id', 'body'],
        additionalProperties: false,
        $defs: {
          Profile: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              title: { type: ['string', 'null'] },
              rows: { type: 'integer', exclusiveMinimum: 0, maximum: 1000 },
              manager: { $ref: '#/$defs/Person' },
            },
            required: ['name'],
          },
          Person: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
      annotations: { idempotentHint: true, openWorldHint: true },
    });
  });
});

const loopingComponents = {
  schemas: {
    Team: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Member' } } },
    Member: { type: 'object', properties: { team: { $ref: '#/components/schemas/Team' } } },
    Folder: {
      type: 'object',
      properties: { folders: { type: 'array', items: { $ref: '#/components/schemas/Folder' } } },
    },
  },
};

const loopingBody = {
  type: 'object',
  properties: { team: { $ref: '#/components/schemas/Team' }, folder: { $ref: '#/components/schemas/Folder' } },
};

const loopingPaths = {
  '/teams': { post: { requestBody: { content: { 'application/json': { schema: loopingBody } } } } },
};

describe('the components of an HTTP API that refer to each other or to themselves', () => {
  it('stand alone under $defs, each once, and no object of the schema loops back on itself', () => {
    const [operation] = toolsOf(documentOf(loopingPaths, { components: loopingComponents })).operations;
    const schema = operation?.tool.inputSchema;

    expect(schema).toEqual({
      type: 'object',
      properties: {
        body: { type: 'object', properties: { team: { $ref: '#/$defs/Team' }, folder: { $ref: '#/$defs/Folder' } } },
      },
      additionalProperties: false,
      $defs: {
        Folder: { type: 'object', properties: { folders: { type: 'array', items: { $ref: '#/$defs/Folder' } } } },
        Team: { type: 'object', properties: { lead: { $ref: '#/$defs/Member' } } },
        Member: { type: 'object', properties: { team: { $ref: '#/$defs/Team' } } },
      },
    });
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe('the names derived from a path of an HTTP API', () => {
  it('read a path of 200,000 braces in one pass, as they read a server address of as many', () => {
    const braces = '{'.repeat(200_000);
    const [operation] = toolsOf(documentOf({ [`/${braces}`]: { get: {} } })).operations;

    expect(operation?.tool.name).toBe(`get_${'{'.repeat(124)}`.replaceAll('{', '_'));
  });
});

function propertiesOf(
  count: number,
): Readonly<Record<string, { readonly type: string; readonly description: string }>> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`p${index}`, { type: 'string', description: 'd'.repeat(40) }]),
  );
}

function bodyOf(schema: Schema.Json): Schema.JsonObject {
  return { post: { requestBody: { content: { 'application/json': { schema } } } } };
}

const sharedLarge = { $ref: '#/components/schemas/Large' };

const oversized =
  "its input schema, with the components it refers to, takes more than the 65536 bytes as JSON a tool's input schema may take";

const listedTooLarge: unknown = expect.stringMatching(
  /^The tools of the document take \d+ bytes as a listing, more than the 16777216 bytes a listing of a tool server's tools may take$/u,
);

describe('the size of the tools of an HTTP API', () => {
  it('leaves out an operation whose input schema, with the components it refers to, takes more than 64 KiB', () => {
    const tools = toolsOf(
      documentOf(
        {
          '/large': bodyOf(sharedLarge),
          '/inline': bodyOf({ type: 'object', properties: propertiesOf(1500) }),
          '/small': bodyOf({ $ref: '#/components/schemas/Small' }),
        },
        { components: { schemas: { Large: { type: 'object', properties: propertiesOf(1500) }, Small: {} } } },
      ),
    );

    expect(tools.operations.map(({ tool }) => tool.name)).toEqual(['post_small']);
    expect(tools.leftOut).toEqual(
      ['POST /large', 'POST /inline'].map((operation) => ({ operation, because: oversized })),
    );
  });

  it('refuses a document whose tools, each within its bound, take more than 16 MiB listed, as an MCP server listing them would', () => {
    const paths = Object.fromEntries(
      Array.from({ length: 400 }, (_, index) => [`/items${index}`, bodyOf(sharedLarge)]),
    );
    const components = { schemas: { Large: { type: 'object', properties: propertiesOf(700) } } };

    expect(problemsOf(documentOf(paths, { components }))).toEqual([{ pointer: '/paths', detail: listedTooLarge }]);
  });
});

describe('the hints and the names of the tools of an HTTP API', () => {
  it('are read-only for GET and HEAD, destructive for DELETE, idempotent for both and for PUT, and open to the world', () => {
    const tools = toolsOf(
      documentOf({ '/notes': { get: {}, head: {}, post: {}, put: {}, patch: {}, delete: {}, options: {} } }),
    );

    expect(tools.operations.map(({ tool }) => [tool.name, tool.annotations])).toEqual([
      ['get_notes', { readOnlyHint: true, idempotentHint: true, openWorldHint: true }],
      ['put_notes', { idempotentHint: true, openWorldHint: true }],
      ['post_notes', { openWorldHint: true }],
      ['delete_notes', { destructiveHint: true, idempotentHint: true, openWorldHint: true }],
      ['options_notes', { openWorldHint: true }],
      ['head_notes', { readOnlyHint: true, idempotentHint: true, openWorldHint: true }],
      ['patch_notes', { openWorldHint: true }],
    ]);
  });

  it('are the operationId with what a tool name cannot hold as underscores, or the method and the path', () => {
    const tools = toolsOf(
      documentOf({
        '/Users/{userId}/Notes': { get: {}, post: { operationId: ' ' } },
        '/notes': { get: { operationId: 'notes:list v2' }, post: { operationId: `make${'x'.repeat(200)}` } },
      }),
    );

    expect(tools.operations.map(({ tool }) => tool.name)).toEqual([
      'get_users_userid_notes',
      'post_users_userid_notes',
      'notes_list_v2',
      `make${'x'.repeat(124)}`,
    ]);
  });
});

describe('the descriptions and the bodies of the tools of an HTTP API', () => {
  it('are the summary and the description of their operation, either alone, or none', () => {
    const tools = toolsOf(
      documentOf({
        '/a': { get: { summary: 'Reads a.', description: ' ' } },
        '/b': { get: { description: 'Reads b.' } },
        '/c': { get: {} },
      }),
    );

    expect(tools.operations.map(({ tool }) => tool.description)).toEqual(['Reads a.', 'Reads b.', undefined]);
  });

  it('take a body of any JSON media type, and none from a body that holds no content', () => {
    const tools = toolsOf(
      documentOf({
        '/a': { post: { requestBody: { content: { 'application/vnd.api+json; charset=utf-8': {} } } } },
        '/b': { post: { requestBody: { content: {} } } },
      }),
    );

    expect(tools.operations.map(({ tool, body }) => [tool.inputSchema, body])).toEqual([
      [
        { type: 'object', properties: { body: {} }, additionalProperties: false },
        { mediaType: 'application/vnd.api+json; charset=utf-8', required: false },
      ],
      [{ type: 'object', properties: {}, additionalProperties: false }, null],
    ]);
  });
});

describe('the parameters of the tools of an HTTP API', () => {
  it('take any value without a schema, keep the description of a schema, and offer no optional header', () => {
    const [operation] = toolsOf(
      documentOf({
        '/a': {
          get: {
            parameters: [
              { name: 'q', in: 'query', description: 'Words' },
              { name: 'n', in: 'query', description: 'A count', schema: { type: 'integer', description: 'How many' } },
              { name: 'X-Trace', in: 'header' },
              { name: 'session', in: 'cookie', required: false },
            ],
          },
        },
      }),
    ).operations;

    expect(operation?.tool.inputSchema).toEqual({
      type: 'object',
      properties: { q: { description: 'Words' }, n: { type: 'integer', description: 'How many' } },
      additionalProperties: false,
    });
    expect(operation?.inputs).toEqual([
      { name: 'q', in: 'query', joinsLists: false },
      { name: 'n', in: 'query', joinsLists: false },
    ]);
  });
});

describe('the parameters and the bodies an HTTP API keeps among its components', () => {
  it('are resolved, and a parameter of an operation overrides the one of its path', () => {
    const components = {
      parameters: { Limit: { $ref: '#/components/parameters/Count' }, Count: { name: 'limit', in: 'query' } },
      requestBodies: { Note: { content: { 'application/json': { schema: { type: 'string' } } } } },
    };
    const tools = toolsOf(
      documentOf(
        {
          '/a': {
            parameters: [{ $ref: '#/components/parameters/Limit' }],
            get: { parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } }] },
            post: { requestBody: { $ref: '#/components/requestBodies/Note' } },
          },
        },
        { components },
      ),
    );

    expect(tools.operations.map(({ tool }) => tool.inputSchema)).toEqual([
      { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'], additionalProperties: false },
      { type: 'object', properties: { limit: {}, body: { type: 'string' } }, additionalProperties: false },
    ]);
  });
});

describe('the answers of an operation of an HTTP API', () => {
  it('are the JSON schemas of its successful responses, followed where a response refers to one, translated as its inputs are', () => {
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
      '204': {},
      '404': { content: { 'application/json': { schema: { type: 'object' } } } },
      default: { content: { 'application/json': { schema: { type: 'object' } } } },
    };
    const listed = { type: 'array', items: { $ref: '#/components/schemas/Message' } };
    const components = {
      schemas: { Message: { type: 'object', properties: { raw: { type: 'string', format: 'byte', nullable: true } } } },
      responses: { Listed: { content: { 'application/problem+json': { schema: listed } } } },
    };
    const document = {
      ...documentOf({ '/messages/{id}': { get: { operationId: 'getMessage', responses } } }, { components }),
      openapi: '3.0.3',
    };

    const [operation] = toolsOf(document).operations;

    expect(operation?.answers).toEqual({
      schemas: [{ $ref: '#/$defs/Message' }, { type: 'array', items: { $ref: '#/$defs/Message' } }],
      components: { Message: { type: 'object', properties: { raw: { type: ['string', 'null'], format: 'byte' } } } },
    });
  });
});
