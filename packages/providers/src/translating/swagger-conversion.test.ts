import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { trackerAuthorizationServer } from '../testing/discovery-documents.ts';
import { foldersOpenApi, notesConversion, notesSwagger } from '../testing/swagger-documents.ts';
import { isJsonFields, type JsonFields } from './openapi-operations.ts';
import { convertedDocumentOf, SwaggerConversionSchema } from './swagger-conversion.ts';

const decodeConversion = Schema.decodeUnknownSync(SwaggerConversionSchema);

const converted = convertedDocumentOf(
  [notesSwagger, foldersOpenApi],
  decodeConversion(notesConversion),
  trackerAuthorizationServer,
);

const json = 'application/json';

function referenceTo(name: string) {
  return { [json]: { schema: { $ref: `#/components/schemas/${name}` } } };
}

function convertedWith(changes: Readonly<Record<string, unknown>>, sources: readonly unknown[] = [notesSwagger]) {
  return () =>
    convertedDocumentOf(sources, decodeConversion({ ...notesConversion, ...changes }), trackerAuthorizationServer);
}

function methodsOf({ paths }: JsonFields): readonly (readonly [string, readonly string[]])[] {
  return Object.entries(isJsonFields(paths) ? paths : {}).map(([path, item]: readonly [string, Schema.Json]) => [
    path,
    Object.keys(isJsonFields(item) ? item : {}),
  ]);
}

const parametersOfTheNotes = [
  { name: 'locale', in: 'query', description: 'The locale of names', schema: { type: 'string', default: 'en_US' } },
  {
    name: 'expansion',
    in: 'query',
    description: 'What each note adds. Comma-separated; the values: tags, owner.',
    schema: { type: 'string', default: 'tags' },
  },
  {
    name: 'sizes',
    in: 'query',
    description: 'Comma-separated; the values: 10, 20.',
    schema: { type: 'string', default: '10' },
  },
  { name: 'shared', in: 'query', description: 'Shared notes alone', schema: { type: 'boolean' } },
  {
    name: 'limit',
    in: 'query',
    required: true,
    description: '',
    schema: { type: 'integer', format: 'int32', minimum: 1, maximum: 100 },
  },
  { name: 'ids', in: 'query', description: '', schema: { type: 'string' } },
];

const parametersOfTheFolders = [
  {
    name: 'expansion',
    in: 'query',
    description: 'The fields each folder adds. Comma-separated; the values: name.',
    schema: { type: 'string' },
  },
  { name: 'limit', in: 'query', description: '', schema: { type: 'string', default: '10' } },
];

const noteId = { name: 'noteId', in: 'path', required: true, schema: { type: 'string' } };

const bodiesAndAnswers = {
  '/notes': {
    get: {
      responses: {
        '200': { description: 'The notes', content: referenceTo('NoteList') },
        '204': { description: 'No notes' },
        '500': { description: 'HTTP 500', content: referenceTo('Failure') },
      },
    },
    post: {
      description: 'Creates a note',
      parameters: [],
      requestBody: { required: true, description: 'The note', content: referenceTo('Note') },
    },
  },
  '/notes/{noteId}': {
    delete: {
      parameters: [{ ...noteId, description: 'The note' }],
      requestBody: { content: { [json]: { schema: { type: 'object' } } } },
    },
  },
  '/folders': {
    put: { parameters: [], requestBody: { required: true, content: referenceTo('Folder') } },
    patch: { requestBody: { description: 'Nothing to send', content: { [json]: { schema: {} } } } },
  },
};

const schemasReached = {
  Failure: { type: 'object', properties: { message: { type: 'string' } } },
  Folder: { type: 'object', additionalProperties: true, properties: { name: { type: 'string' } } },
  Note: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', examples: ['Plans'] },
      owner: { $ref: '#/components/schemas/Owner' },
      tags: { type: ['array', 'null'], items: { type: 'string' } },
      parent: { allOf: [{ $ref: '#/components/schemas/Owner' }] },
      extra: { additionalProperties: {} },
      listed: { properties: ['not', 'a', 'map'] },
    },
  },
  NoteList: { type: 'object', properties: { notes: { type: 'array', items: { $ref: '#/components/schemas/Note' } } } },
  Owner: { type: ['object', 'null'], properties: { name: { type: ['string', 'null'] } } },
};

const oauth2 = {
  type: 'oauth2',
  flows: {
    authorizationCode: {
      authorizationUrl: trackerAuthorizationServer.authorization_endpoint,
      tokenUrl: trackerAuthorizationServer.token_endpoint,
      scopes: {},
    },
  },
};

const budgets = {
  openapi: '3.0.1',
  paths: { '/v1/budgets': { post: { operationId: 'UpdateBudget', responses: { '200': { description: 'Updated' } } } } },
};

describe('a document converted from a Swagger 2.0 and an OpenAPI 3 description', () => {
  it('holds the operations of each source in the order the conversion keeps them, below the prefix, requiring the one oauth2 scheme at its root', () => {
    expect(converted).toMatchObject({ openapi: '3.1.0', info: notesConversion.info, security: [{ oauth2: [] }] });
    expect(methodsOf(converted)).toEqual([
      ['/notes', ['get', 'post']],
      ['/notes/{noteId}', ['get', 'delete']],
      ['/folders', ['get', 'put', 'patch']],
    ]);
  });
});

describe('the parameters of a converted document', () => {
  it('leave out the headers the entry sends and the parameter of the prefix, and write a list in a query as text whose description ends its sentence first', () => {
    expect(converted).toMatchObject({
      paths: {
        '/notes': {
          get: {
            operationId: 'listNotes',
            tags: ['Notes'],
            summary: 'Lists the notes',
            parameters: parametersOfTheNotes,
          },
        },
        '/notes/{noteId}': { get: { parameters: [noteId] } },
        '/folders': { get: { parameters: parametersOfTheFolders } },
      },
    });
  });
});

describe('the bodies and the answers of a converted document', () => {
  it('are a JSON request body and JSON content, an answer without a description named by its status', () => {
    expect(converted).toMatchObject({ paths: bodiesAndAnswers });
  });
});

describe('the components of a converted document', () => {
  it('hold the schemas the kept operations reach, by name, written as OpenAPI 3.1 writes them, and the oauth2 scheme at the endpoints of the authorization server', () => {
    expect(converted['components']).toEqual({ schemas: schemasReached, securitySchemes: { oauth2 } });
  });
});

describe('a description whose prefix holds no parameter', () => {
  it('is converted below its prefix alone', () => {
    const converting = convertedWith(
      {
        sources: [{ address: 'https://docs.campaigns.example.com/openapi.json', operations: ['UpdateBudget'] }],
        path_prefix: { prefix: '/v1', because: 'The entry gives it' },
      },
      [budgets],
    );

    expect(converting()['paths']).toEqual({
      '/budgets': {
        post: { operationId: 'UpdateBudget', parameters: [], responses: { '200': { description: 'Updated' } } },
      },
    });
  });
});

describe('a conversion refused for what the manifest asks', () => {
  it('names an operation the source lacks, a header the manifest does not leave out and a path outside the prefix', () => {
    expect(convertedWith({ sources: [{ address: 'notes', operations: ['listNotes', 'shareNote'] }] })).toThrow(
      'The documents the translation is made from have no operation shareNote',
    );
    expect(convertedWith({ headers_left_out: { names: ['Authorization'], because: 'The runtime sends it' } })).toThrow(
      'The operation keeps the parameter X-Api-Key in header, which the conversion writes nowhere',
    );
    expect(convertedWith({ path_prefix: { prefix: '/{tenant}', because: 'The entry gives it' } })).toThrow(
      'The path /{companyId}/notes does not start with /{tenant}, which every path the document keeps starts with',
    );
  });
});

describe('a conversion refused for what the sources hold', () => {
  it('names a schema the source lacks, two sources whose schemas of one name differ, a parameter the source refers to and lacks, and a source that is no description', () => {
    const lacking = Object.fromEntries(
      Object.entries(notesSwagger.definitions).filter(([name]: readonly [string, unknown]) => name !== 'Note'),
    );
    const owner = { type: 'object', properties: { id: { type: 'string' } } };
    const otherOwner = {
      ...foldersOpenApi,
      components: { schemas: { ...foldersOpenApi.components.schemas, Owner: owner } },
    };

    expect(convertedWith({}, [{ ...notesSwagger, definitions: lacking }])).toThrow(
      'The description has no schema Note, which an operation the document keeps refers to',
    );
    expect(convertedWith({ sources: notesConversion.sources }, [notesSwagger, otherOwner])).toThrow(
      'Two descriptions hold a schema Owner, and the two differ',
    );
    expect(convertedWith({}, [{ ...notesSwagger, parameters: {} }])).toThrow('Missing key');
    expect(convertedWith({}, [['not', 'a', 'description']])).toThrow(
      'The documents the translation is made from have no operation listNotes',
    );
  });
});
