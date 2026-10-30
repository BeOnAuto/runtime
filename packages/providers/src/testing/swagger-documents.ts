import { trackerManifest } from './discovery-documents.ts';

const company = { name: 'companyId', in: 'path', required: true, type: 'string', description: 'The company' };

const signedIn = [
  { name: 'Authorization', in: 'header', required: true, type: 'string' },
  { name: 'X-Api-Key', in: 'header', required: true, type: 'string' },
];

const answers = {
  '200': { description: 'The notes', schema: { $ref: '#/definitions/NoteList' } },
  '204': { description: 'No notes' },
  '500': { schema: { $ref: '#/definitions/Failure' } },
};

export const notesSwagger = {
  swagger: '2.0',
  info: { title: 'Notes', version: '2.0' },
  parameters: {
    locale: { name: 'locale', in: 'query', type: 'string', default: 'en_US', description: 'The locale of names' },
  },
  paths: {
    '/{companyId}/notes': {
      'x-owner': 'notes-team',
      get: {
        operationId: 'listNotes',
        tags: ['Notes'],
        summary: 'Lists the notes',
        parameters: [
          company,
          ...signedIn,
          { $ref: '#/parameters/locale' },
          {
            name: 'expansion',
            in: 'query',
            type: 'array',
            items: { type: 'string', enum: ['tags', 'owner'] },
            collectionFormat: 'csv',
            default: ['tags'],
            description: 'What each note adds',
          },
          { name: 'sizes', in: 'query', type: 'array', items: { type: 'integer', enum: [10, 20] }, default: [10] },
          { name: 'shared', in: 'query', type: 'boolean', enum: ['true'], description: 'Shared notes alone' },
          { name: 'limit', in: 'query', required: true, type: 'integer', format: 'int32', minimum: 1, maximum: 100 },
          { name: 'ids', in: 'query', type: 'array', items: { type: 'string' } },
        ],
        responses: answers,
      },
      post: {
        operationId: 'createNote',
        description: 'Creates a note',
        parameters: [
          company,
          ...signedIn,
          { name: 'body', in: 'body', required: true, description: 'The note', schema: { $ref: '#/definitions/Note' } },
        ],
        responses: { '200': { description: 'The note', schema: { $ref: '#/definitions/Note' } } },
      },
    },
    '/{companyId}/notes/{noteId}': {
      get: {
        operationId: 'getNote',
        parameters: [company, { name: 'noteId', in: 'path', required: true, type: 'string' }],
        responses: { '200': { description: 'The note', schema: { $ref: '#/definitions/Note' } } },
      },
      delete: {
        operationId: 'deleteNote',
        parameters: [
          company,
          { name: 'noteId', in: 'path', required: true, type: 'string', description: 'The note' },
          { name: 'body', in: 'body', schema: { type: 'object' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/{companyId}/archive': { get: { operationId: 'archiveNotes', responses: {} } },
    '/{companyId}/untitled': { get: { summary: 'An operation without an id' } },
  },
  definitions: {
    NoteList: { type: 'object', properties: { notes: { type: 'array', items: { $ref: '#/definitions/Note' } } } },
    Note: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', example: 'Plans' },
        owner: { $ref: '#/definitions/Owner' },
        tags: { type: 'array', nullable: true, items: { type: 'string' } },
        parent: { allOf: [{ $ref: '#/definitions/Owner' }] },
        extra: { additionalProperties: { nullable: true } },
        listed: { properties: ['not', 'a', 'map'] },
      },
    },
    Owner: { type: 'object', nullable: true, properties: { name: { type: 'string', nullable: true } } },
    Failure: { type: 'object', properties: { message: { type: 'string' } } },
    Unused: { type: 'string' },
  },
};

export const foldersOpenApi = {
  openapi: '3.0.1',
  info: { title: 'Folders', version: '1.0' },
  paths: {
    '/{companyId}/folders': {
      get: {
        operationId: 'listFolders',
        parameters: [
          { name: 'companyId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' } },
          {
            name: 'expansion',
            in: 'query',
            style: 'form',
            explode: false,
            description: 'The fields each folder adds.',
            schema: { type: 'array', items: { type: 'string', enum: ['name'] } },
          },
          { name: 'limit', in: 'query', schema: { type: 'string', default: '10' } },
        ],
        responses: {
          '200': {
            description: 'The folders',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Owner' } } },
          },
        },
      },
      put: {
        operationId: 'renameFolder',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Folder' } } },
        },
        responses: { '200': { description: 'Renamed' } },
      },
      patch: {
        operationId: 'touchFolder',
        requestBody: { description: 'Nothing to send', content: { 'text/plain': {} } },
        responses: { '200': { description: 'Touched' } },
      },
    },
  },
  components: {
    schemas: {
      Owner: { type: 'object', nullable: true, properties: { name: { type: 'string', nullable: true } } },
      Folder: { type: 'object', additionalProperties: true, properties: { name: { type: 'string' } } },
    },
  },
};

export const notesAddress = 'https://docs.notes.example.com/swagger.json';

export const foldersAddress = 'https://docs.notes.example.com/folders.json';

export const notesConversion = {
  sources: [
    { address: notesAddress, operations: ['listNotes', 'createNote', 'getNote', 'deleteNote'] },
    { address: foldersAddress, operations: ['listFolders', 'renameFolder', 'touchFolder'] },
  ],
  info: { title: 'Notes API', version: '2.0', description: 'Seven operations of the notes of a company.' },
  path_prefix: { prefix: '/{companyId}', because: 'The entry gives the company in its base_url' },
  headers_left_out: { names: ['authorization', 'x-api-key'], because: 'The runtime sends both' },
  lists_as_text: 'The API reads a list as its values comma-separated',
  boolean_values_left_out: "The vendor lists 'true' as a boolean's one value",
};

export const notesManifest = {
  type: 'swagger',
  authorization_server: trackerManifest.authorization_server,
  ...notesConversion,
};
