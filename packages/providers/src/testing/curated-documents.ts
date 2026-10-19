import {
  trackerAuthorizationServer,
  trackerMutateId as mutateId,
  trackerReadScope as readScope,
  trackerWriteScope as writeScope,
} from './discovery-documents.ts';

export const fieldsParameter = {
  name: 'fields',
  in: 'query',
  description: 'Selector specifying which fields to include.',
  schema: { type: 'string' },
};

const projectsId = { name: 'projectsId', in: 'path', required: true, schema: { type: 'string' } };

const projectAndIssue = [projectsId, { name: 'issuesId', in: 'path', required: true, schema: { type: 'string' } }];

const onlyWrite = [{ oauth2: [writeScope] }];

function jsonOf(schema: string) {
  return { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } };
}

function answeredWith(schema: string) {
  return { '2XX': { description: schema, content: jsonOf(schema) } };
}

export function trackerSecuritySchemes(scopes: Readonly<Record<string, string>>): Readonly<Record<string, unknown>> {
  return {
    oauth2: {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: trackerAuthorizationServer.authorization_endpoint,
          tokenUrl: trackerAuthorizationServer.token_endpoint,
          scopes,
        },
      },
    },
  };
}

const trackerSchemes = trackerSecuritySchemes({ [readScope]: 'Read issues', [writeScope]: 'Change issues' });

const issueSchema = {
  type: 'object',
  properties: {
    extra: { description: 'Anything.' },
    labels: { items: { $ref: '#/components/schemas/Label' }, type: 'array' },
    name: { readOnly: true, type: 'string' },
    state: { enum: ['OPEN', 'CLOSED'], type: 'string' },
  },
};

const trackerPaths = {
  '/v1/projects/{projectsId}/issues': {
    get: {
      operationId: 'tracker.projects.issues.list',
      description: 'Lists issues.',
      parameters: [
        projectsId,
        {
          name: 'labels',
          in: 'query',
          description: 'Labels to match.',
          schema: { type: 'array', items: { type: 'string' } },
        },
        { name: 'pageSize', in: 'query', schema: { format: 'int32', maximum: 100, minimum: 1, type: 'integer' } },
        { name: 'query', in: 'query', required: true, description: 'What to match.', schema: { type: 'string' } },
        fieldsParameter,
      ],
      responses: answeredWith('ListIssuesResponse'),
      security: [{ oauth2: [readScope] }, { oauth2: [writeScope] }],
    },
  },
  '/v1/projects/{projectsId}/issues/{issuesId}': {
    patch: {
      operationId: 'tracker.projects.issues.patch',
      parameters: [
        ...projectAndIssue,
        { name: 'updateMask', in: 'query', schema: { format: 'field-mask', type: 'string' } },
        fieldsParameter,
      ],
      requestBody: { required: true, content: jsonOf('Issue') },
      responses: answeredWith('Issue'),
      security: onlyWrite,
    },
    delete: {
      operationId: 'tracker.projects.issues.delete',
      deprecated: true,
      parameters: [...projectAndIssue, fieldsParameter],
      responses: { '2XX': { description: 'An empty body' } },
      security: onlyWrite,
    },
  },
  '/v1/projects/{projectsId}/issues/{issuesId}:attach': {
    post: {
      operationId: 'tracker.projects.issues.attach',
      parameters: [
        { name: 'projectsId', in: 'path', required: true, description: 'The project.', schema: { type: 'string' } },
        { name: 'issuesId', in: 'path', required: true, description: 'The issue.', schema: { type: 'string' } },
        fieldsParameter,
      ],
      responses: { '2XX': { description: 'An empty body' } },
      security: onlyWrite,
    },
  },
  '/v1/about/{version}': {
    get: {
      operationId: 'tracker.about.get',
      parameters: [
        { name: 'version', in: 'path', required: true, description: 'The version.', schema: { type: 'string' } },
        { name: 'fields', in: 'query', description: 'Its own fields.', schema: { type: 'string' } },
      ],
      responses: { '2XX': { description: 'An empty body' } },
      security: [{ oauth2: [readScope] }],
    },
  },
};

const trackerSchemas = {
  Issue: issueSchema,
  Label: { additionalProperties: false, properties: { title: { type: 'string' } }, type: 'object' },
  ListIssuesResponse: {
    properties: {
      issues: { items: { $ref: '#/components/schemas/Issue' }, type: 'array' },
      nextPageToken: { type: 'string' },
    },
    type: 'object',
  },
};

export const trackerCurated = {
  openapi: '3.1.0',
  info: { title: 'Tracker API', version: 'v1', description: 'Reads and changes issues.' },
  externalDocs: { url: 'https://developers.example.com/tracker' },
  servers: [{ url: 'https://tracker.example.com/tracker' }],
  security: [{ oauth2: [] }],
  paths: trackerPaths,
  components: { schemas: trackerSchemas, securitySchemes: trackerSchemes },
};

export const trackerTranslated = {
  ...trackerCurated,
  paths: {
    ...trackerPaths,
    '/v1/projects/{projectsId}/issues:mutate': {
      post: {
        operationId: mutateId,
        parameters: [projectsId, fieldsParameter],
        requestBody: { required: true, content: jsonOf('MutateIssuesRequest') },
        responses: answeredWith('MutateIssuesResponse'),
        security: onlyWrite,
      },
    },
  },
  components: {
    schemas: {
      ...trackerSchemas,
      IssueOperation: {
        description: 'A change of an issue.',
        properties: {
          create: { $ref: '#/components/schemas/Issue_Writable', description: 'The issue to create.' },
          remove: { type: 'string' },
          update: { $ref: '#/components/schemas/Issue_Writable' },
        },
        type: 'object',
      },
      Issue_Writable: {
        description:
          'The fields a request of this document sets: its output-only fields and what anything holds are left out.',
        properties: {
          labels: { items: { $ref: '#/components/schemas/Label' }, type: 'array' },
          state: { enum: ['OPEN', 'CLOSED'], type: 'string' },
        },
        type: 'object',
      },
      MutateIssuesRequest: {
        properties: { operations: { items: { $ref: '#/components/schemas/MutateOperation' }, type: 'array' } },
        type: 'object',
      },
      MutateIssuesResponse: {
        properties: { issues: { items: { $ref: '#/components/schemas/Issue' }, type: 'array' } },
        type: 'object',
      },
      LabelOperation: {
        properties: { create: { $ref: '#/components/schemas/Label_Writable' } },
        type: 'object',
      },
      Label_Writable: {
        additionalProperties: false,
        description: 'The fields a request of this document sets: its output-only fields are left out.',
        properties: { title: { type: 'string' } },
        type: 'object',
      },
      MutateOperation: {
        description: 'One change. In this document it holds the changes of issues and labels alone.',
        properties: {
          issueOperation: { $ref: '#/components/schemas/IssueOperation' },
          labelOperation: { $ref: '#/components/schemas/LabelOperation' },
        },
        type: 'object',
      },
    },
    securitySchemes: trackerSchemes,
  },
};
