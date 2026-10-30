import { answeredUndescribed, info, servers, trackerMetadataAddress, trackerSchemesOf } from './openapi-documents.ts';

export const aboutYaml = [
  'openapi: 3.1.0',
  'paths:',
  '  /about:',
  '    get:',
  '      operationId: about',
  '      responses:',
  "        '200':",
  '          description: What the tracker is',
  '          content:',
  '            application/json:',
  '              schema:',
  '                type: object',
  '      x-extensions:',
  '        x-permissions:',
  '          - Tracker:Read',
  '        x-granular-scopes:',
  '          - about:read',
].join('\n');

const calendarAddress = 'https://developers.tracker.example.com/api/calendar.yaml';

const eventIdOfThePath = {
  name: 'event-id',
  in: 'path',
  required: true,
  description: 'The id of the event',
  schema: { type: 'string' },
};

const eventIdOfTheOperation = { ...eventIdOfThePath, description: 'The id of the event to read' };

const consistency = { $ref: '#/components/parameters/consistency' };

const select = { name: '$select', in: 'query', style: 'form', explode: false, schema: { type: 'array' } };

const movedExample = { $ref: '#/components/examples/moved' };

function eventBodyMapping(mapping: Readonly<Record<string, string>>) {
  return {
    content: {
      'application/json': {
        schema: {
          oneOf: [{ $ref: '#/components/schemas/event' }],
          discriminator: { propertyName: '@odata.type', mapping },
        },
        examples: { moved: movedExample },
      },
    },
  };
}

const exampleNamingAMissingSchema = { discriminator: { propertyName: 'kind', mapping: { gone: 'gone' } } };

const answeredWithAnEvent = { '2XX': { $ref: '#/components/responses/event' } };

const calendarSchemas = {
  entity: {
    type: 'object',
    discriminator: {
      propertyName: '@odata.type',
      mapping: {
        '#tracker.event': '#/components/schemas/event',
        '#tracker.message': '#/components/schemas/message',
        '#tracker.note': 'note',
        '#tracker.self': 'event',
      },
    },
  },
  event: {
    allOf: [
      { $ref: '#/components/schemas/entity' },
      {
        type: 'object',
        discriminator: { propertyName: '@odata.type' },
        properties: { subject: { type: 'string' }, discriminator: { type: 'string' } },
        example: exampleNamingAMissingSchema,
      },
    ],
  },
};

const calendarExamples = { moved: { value: exampleNamingAMissingSchema } };

const calendarParameters = { consistency: { name: 'ConsistencyLevel', in: 'header', schema: { type: 'string' } } };

export const calendarSource = {
  openapi: '3.0.4',
  servers,
  paths: {
    '/me/events/{event-id}': {
      description: 'The events of the person',
      get: {
        tags: ['me.event'],
        summary: 'Get open extension',
        description: 'Get an open extension identified by name.',
        externalDocs: { description: 'Find more info here', url: 'https://docs.tracker.example.com/extension-get' },
        operationId: 'me.GetEvents',
        parameters: [select, eventIdOfTheOperation],
        responses: answeredWithAnEvent,
        'x-ms-docs-operation-type': 'operation',
      },
      patch: {
        tags: ['me.event'],
        summary: 'Update event',
        operationId: 'me.UpdateEvents',
        requestBody: eventBodyMapping({ '#tracker.event': 'event', '#tracker.gone': '#/components/schemas/gone' }),
        responses: answeredWithAnEvent,
      },
      parameters: [eventIdOfThePath, consistency],
    },
    '/me/messages': {
      get: { summary: 'List messages', operationId: 'me.ListMessages', responses: answeredWithAnEvent },
    },
  },
  components: {
    schemas: { ...calendarSchemas, message: { allOf: [{ $ref: '#/components/schemas/entity' }] } },
    responses: { event: { description: 'The event' } },
    parameters: calendarParameters,
    examples: calendarExamples,
  },
};

export const calendarManifest = {
  type: 'openapi',
  sources: [calendarAddress],
  authorization_server: trackerMetadataAddress,
  info,
  operations: ['me.GetEvents', 'me.UpdateEvents'],
  left_out_descriptions: [
    { operations: ['me.GetEvents'], because: 'Its summary, description and link describe an open extension' },
  ],
  scheme: { name: 'tracker_oauth', lists_no_scopes: 'The vendor names no permission for any operation' },
  keeps_responses: false,
};

export const calendarTranslated = {
  openapi: '3.0.4',
  info,
  servers,
  security: [{ tracker_oauth: [] }],
  paths: {
    '/me/events/{event-id}': {
      get: {
        tags: ['me.event'],
        operationId: 'me.GetEvents',
        parameters: [consistency, select, eventIdOfTheOperation],
        responses: answeredUndescribed,
      },
      patch: {
        tags: ['me.event'],
        summary: 'Update event',
        operationId: 'me.UpdateEvents',
        requestBody: eventBodyMapping({ '#tracker.event': 'event' }),
        responses: answeredUndescribed,
        parameters: [eventIdOfThePath, consistency],
      },
    },
  },
  components: {
    examples: calendarExamples,
    parameters: calendarParameters,
    schemas: {
      ...calendarSchemas,
      entity: {
        type: 'object',
        discriminator: {
          propertyName: '@odata.type',
          mapping: { '#tracker.event': '#/components/schemas/event', '#tracker.self': 'event' },
        },
      },
    },
    securitySchemes: trackerSchemesOf({}),
  },
};
