import type { Schema } from 'effect';

export type FakeApiVersion = '3.0' | '3.1';

type DocumentFields = Readonly<Record<string, Schema.Json>>;

const profile31: Schema.JsonObject = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    title: { type: ['string', 'null'] },
    rows: { type: 'integer', exclusiveMinimum: 0, maximum: 1000 },
    manager: { $ref: '#/components/schemas/Person' },
  },
  required: ['name'],
};

const profile30: Schema.JsonObject = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    title: { type: 'string', nullable: true },
    rows: { type: 'integer', minimum: 0, exclusiveMinimum: true, maximum: 1000 },
    manager: { $ref: '#/components/schemas/Person' },
  },
  required: ['name'],
};

const person: Schema.JsonObject = { type: 'object', properties: { name: { type: 'string' } } };

const json = (schema: Schema.JsonObject): DocumentFields => ({ content: { 'application/json': { schema } } });

const profileId: Schema.JsonObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'The id of the profile',
  schema: { type: 'string' },
};

const noteIdHeader: DocumentFields = {
  description: 'The note, whose id the X-Note-Id header carries.',
  headers: { 'X-Note-Id': { schema: { type: 'string' } } },
};

function readPaths(): DocumentFields {
  return {
    '/search': {
      get: {
        operationId: 'search',
        summary: 'Finds the rows of the graph that match a query.',
        parameters: [
          { name: 'query', in: 'query', required: true, schema: { type: 'string' }, description: 'What to look for' },
        ],
      },
    },
    '/echo': {
      post: {
        operationId: 'echo',
        summary: 'Answers with its arguments.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
      },
    },
    '/profiles/{id}': {
      parameters: [{ $ref: '#/components/parameters/ProfileId' }],
      get: { summary: 'Reads a profile.', description: 'The profile of one person, with the rows they own.' },
      put: { operationId: 'updateProfile', requestBody: { $ref: '#/components/requestBodies/Profile' } },
      delete: { operationId: 'removeProfile' },
    },
  };
}

function otherPaths(): DocumentFields {
  return {
    '/rows': {
      get: {
        operationId: 'rows',
        parameters: [{ name: 'tag', in: 'query', schema: { type: 'array', items: { type: 'string' } } }],
      },
    },
    '/denied': { get: { operationId: 'denied', summary: 'Answers as a policy that denies a field.' } },
    '/photo': { get: { operationId: 'photo' } },
    '/notes': {
      get: { operationId: 'notes', security: [] },
      put: {
        operationId: 'saveNote',
        security: [],
        responses: { '200': { ...noteIdHeader, ...json({ type: 'object' }) } },
      },
      post: { operationId: 'addNote', security: [], responses: { '201': noteIdHeader } },
    },
    '/files/{fileName}': {
      get: {
        operationId: 'file',
        summary: 'Answers the file of a name.',
        parameters: [{ name: 'fileName', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
    '/sessions': {
      get: {
        operationId: 'sessionState',
        parameters: [{ name: 'X-Session', in: 'header', required: true, schema: { type: 'string' } }],
      },
    },
    '/filtered': {
      get: {
        operationId: 'filtered',
        parameters: [{ name: 'filter', in: 'query', schema: { $ref: '#/components/schemas/Person' } }],
      },
    },
    '/uploads': {
      post: {
        operationId: 'upload',
        requestBody: { content: { 'application/xml': { schema: { type: 'string' } } } },
      },
    },
  };
}

const securitySchemes: DocumentFields = {
  apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
  queryKey: { type: 'apiKey', in: 'query', name: 'api_key' },
  bearerAuth: { type: 'http', scheme: 'bearer' },
  basicAuth: { type: 'http', scheme: 'basic' },
  clientCredentials: {
    type: 'oauth2',
    flows: { clientCredentials: { tokenUrl: 'https://auth.example.com/token', scopes: {} } },
  },
};

const fakeApiSchemes = Object.keys(securitySchemes);

export function fakeApiDocument(version: FakeApiVersion, serverUrl: string, declaresKey = true): DocumentFields {
  return {
    openapi: version === '3.0' ? '3.0.3' : '3.1.0',
    info: { title: 'Graph', version: '1.0.0' },
    servers: [{ url: serverUrl }],
    security: declaresKey ? fakeApiSchemes.map((scheme) => ({ [scheme]: [] })) : [],
    paths: { ...readPaths(), ...otherPaths() },
    components: {
      schemas: { Profile: version === '3.0' ? profile30 : profile31, Person: person },
      parameters: { ProfileId: profileId },
      requestBodies: { Profile: { required: true, ...json({ $ref: '#/components/schemas/Profile' }) } },
      securitySchemes,
    },
  };
}

export const fakeApiToolNames = [
  'search',
  'echo',
  'get_profiles_id',
  'updateProfile',
  'removeProfile',
  'rows',
  'denied',
  'photo',
  'notes',
  'saveNote',
  'addNote',
  'file',
];
