import { defineCommand, defineQuery, makeCatalog } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { findNotes } from '../testing/found-notes.ts';
import { testShelf } from '../testing/guides.ts';
import { httpAloneOperations } from '../testing/http-alone-operations.ts';
import { listNotesOfTheOrg, notebookOperations } from '../testing/notebook.ts';
import { openApiErrorsIn, operationsIn, unresolvedSchemasIn } from '../testing/openapi/openapi-document.ts';
import { testIdentityIssuer, testServerInfo } from '../testing/operation-server.ts';
import { openApiDocumentOf } from './openapi-document.ts';

const NoteName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u)).annotate({ identifier: 'NoteName' });

const moveNote = defineCommand('playbook', {
  name: 'move_note',
  title: 'Move note',
  description: 'Moves a note to a folder or to the bin. Use it to tidy the notes. `name` names the note.',
  route: { method: 'POST', path: '/notes/{name}/move' },
  inputSchema: Schema.Union([
    Schema.Struct({ name: Schema.String, folder: NoteName }),
    Schema.Struct({ name: Schema.String, bin: Schema.Literal(true) }),
  ]),
  outputSchema: Schema.Struct({ moved: Schema.Boolean }),
  reasons: ['not_found', 'cancelled'],
  handle: () => Effect.succeed({ moved: true }),
});

const findNote = defineQuery('playbook', {
  name: 'find_note',
  title: 'Find note',
  description: 'Finds a note by a name it may have. Use it when the name is not certain. get_note reads one.',
  route: { method: 'GET', path: '/found-notes' },
  inputSchema: Schema.Struct({ like: NoteName }),
  outputSchema: Schema.Struct({ found: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ found: false }),
});

const measureNote = defineQuery('playbook', {
  name: 'measure_note',
  title: 'Measure note',
  description: 'Measures a note in words or in letters. Use it to size a note. It answers a number.',
  route: { method: 'GET', path: '/note-sizes' },
  inputSchema: Schema.Union([Schema.Struct({ words: Schema.Boolean }), Schema.Struct({ letters: Schema.Boolean })]),
  outputSchema: Schema.Struct({ size: Schema.Int }),
  reasons: [],
  handle: () => Effect.succeed({ size: 0 }),
});

const countNotes = defineQuery('org', {
  name: 'count_notes',
  title: 'Count notes',
  description:
    'Counts the notes of the playbooks the caller may read. Use it to size the notebook. It answers a number.',
  route: { method: 'GET', path: '/note-counts' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ notes: Schema.Int }),
  permittedBy: ['org:read', 'playbook:read'],
  reasons: [],
  handle: () => Effect.succeed({ notes: 0 }),
});

const operations = [
  ...notebookOperations,
  findNotes,
  listNotesOfTheOrg,
  ...httpAloneOperations,
  moveNote,
  findNote,
  countNotes,
];

const catalog = makeCatalog(operations);

const document = openApiDocumentOf(catalog, testServerInfo, testShelf, testIdentityIssuer);

function operationNamed(id: string) {
  const found = operationsIn(document).find(({ operation }) => operation.operationId === id);
  if (found === undefined) {
    throw new Error(`The document has no operation ${id}`);
  }
  return found;
}

function keysIn(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, member]: readonly [string, unknown]) => [key].concat(keysIn(member)));
}

const schemaBase = 'https://on.auto/schemas/runtime';

describe('the OpenAPI document of a catalog', () => {
  it('is an OpenAPI 3.1.1 document of JSON Schema 2020-12 that the published schema of OpenAPI 3.1 accepts', () => {
    expect(openApiErrorsIn(document)).toEqual([]);
    expect(document).toMatchObject({
      openapi: '3.1.1',
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      info: { title: 'Auto Runtime', version: '0.0.0-test' },
      servers: [{ url: '/v1' }],
    });
    expect(openApiErrorsIn({ openapi: '3.1.1' })).toContain("data must have required property 'info'");
  });

  it('resolves every reference of a schema within the schema, whose $id names its operation and its role', () => {
    expect(unresolvedSchemasIn(document)).toEqual([]);
    expect(operationNamed('add_note').operation.requestBody).toMatchObject({
      content: { 'application/json': { schema: { $id: `${schemaBase}/add_note/input` } } },
    });
    expect(operationNamed('add_note').operation.responses['201']).toMatchObject({
      content: { 'application/json': { schema: { $id: `${schemaBase}/add_note/output` } } },
    });
    expect(unresolvedSchemasIn({ schema: { $id: `${schemaBase}/lost/input`, $ref: '#/$defs/Lost' } })).toEqual([
      expect.stringMatching(/^https:\/\/on\.auto\/schemas\/runtime\/lost\/input: .*Lost/u),
    ]);
  });

  it('describes each registration once, by its name, its title and the description its tool has', () => {
    expect(operationsIn(document).map(({ operation }) => operation.operationId)).toEqual(
      expect.arrayContaining(['list_notes', 'list_notes_in_org', 'add_note', 'read_blob', 'get_guide']),
    );
    expect(operationsIn(document)).toHaveLength(operations.length + 1);
    expect(operationNamed('list_notes_in_org')).toMatchObject({
      path: '/orgs/{org}/notes',
      method: 'get',
      operation: { summary: 'List notes', description: listNotesOfTheOrg.registration.description },
    });
    expect(operationNamed('add_note').operation).toMatchObject({
      summary: 'Add note',
      tags: ['notes'],
      security: [{ bearer: [] }, { openIdConnect: ['playbook:write'] }],
    });
    expect(keysIn(document).filter((key) => key.startsWith('x-'))).toEqual([]);
  });

  it('refuses a query by GET that takes one of several inputs, which its query parameters cannot tell apart', () => {
    expect(() => openApiDocumentOf(makeCatalog([measureNote]), testServerInfo, testShelf, testIdentityIssuer)).toThrow(
      'The query measure_note takes one of several inputs, which its query parameters cannot tell apart',
    );
  });
});

describe('the input of a query', () => {
  it("is its path's fields and the rest of its input as query parameters, a definition's schema inlined", () => {
    expect(operationNamed('get_note').operation.parameters).toEqual([
      { $ref: '#/components/parameters/org' },
      { $ref: '#/components/parameters/playbook' },
      { name: 'name', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' } },
    ]);
    expect(operationNamed('list_notes').operation.parameters).toContainEqual({
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 100 },
    });
    expect(operationNamed('find_note').operation.parameters).toContainEqual({
      name: 'like',
      in: 'query',
      required: true,
      schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' },
    });
  });

  it('routed by POST, for an input a query string cannot carry, is a JSON body and no query parameter', () => {
    expect(operationNamed('find_notes')).toMatchObject({
      path: '/orgs/{org}/playbooks/{playbook}/notes/found',
      method: 'post',
      operation: {
        parameters: [{ $ref: '#/components/parameters/org' }, { $ref: '#/components/parameters/playbook' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { properties: { words: { type: 'array' } }, required: ['words'] } },
          },
        },
      },
    });
  });
});

describe('the input of a command', () => {
  it("is its path's fields and a JSON body of the rest, required when a field of it is", () => {
    expect(operationNamed('label_playbook').operation).toMatchObject({
      parameters: [{ $ref: '#/components/parameters/org' }, { name: 'playbook', in: 'path', required: true }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
          },
        },
      },
    });
    expect(operationNamed('clear_blobs').operation.requestBody).toBeUndefined();
    expect(operationNamed('rename_blob').operation.requestBody).toMatchObject({
      required: true,
      content: { 'application/json': { schema: { properties: { to: { type: 'string' } }, required: ['to'] } } },
    });
  });

  it('of several inputs takes each without the fields of its path, and its path field from them', () => {
    const { parameters, requestBody } = operationNamed('move_note').operation;

    expect(parameters).toContainEqual({ name: 'name', in: 'path', required: true, schema: { type: 'string' } });
    expect(requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: {
            anyOf: [
              { properties: { folder: { $ref: '#/$defs/NoteName' } }, required: ['folder'] },
              { properties: { bin: { type: 'boolean', enum: [true] } }, required: ['bin'] },
            ],
            $defs: { NoteName: { type: 'string' } },
          },
        },
      },
    });
  });
});

describe('the security of the operations of the document', () => {
  it('takes on every operation but the guides a key, or an access token granted the permission it needs as a scope', () => {
    const { get_guide: guides, ...others } = Object.fromEntries(
      operationsIn(document).map(({ operation }) => [operation.operationId, operation.security]),
    );

    expect(guides).toEqual([]);
    expect(others).toMatchObject({
      list_notes: [{ bearer: [] }, { openIdConnect: ['playbook:read'] }],
      add_note: [{ bearer: [] }, { openIdConnect: ['playbook:write'] }],
      list_notes_in_org: [{ bearer: [] }, { openIdConnect: ['org:read'] }],
      label_playbook: [{ bearer: [] }, { openIdConnect: ['org:write'] }],
    });
    expect(new Set(Object.values(others).map((security) => JSON.stringify(security[0])))).toEqual(
      new Set(['{"bearer":[]}']),
    );
  });

  it('names each permission that permits an operation as the scope of a requirement of its own, any of which serves', () => {
    expect(operationNamed('count_notes').operation.security).toEqual([
      { bearer: [] },
      { openIdConnect: ['org:read'] },
      { openIdConnect: ['playbook:read'] },
    ]);
  });
});
