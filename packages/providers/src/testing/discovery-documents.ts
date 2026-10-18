const readScope = 'https://tracker.example.com/auth/read';

const writeScope = 'https://tracker.example.com/auth/write';

const singleSegmentPath = { type: 'string', location: 'path', required: true, pattern: '^[^/]+$' };

const issuePath = { type: 'string', location: 'path', required: true, pattern: '^projects/[^/]+/issues/[^/]+$' };

export const trackerAuthorizationServer = {
  issuer: 'https://auth.tracker.example.com',
  authorization_endpoint: 'https://auth.tracker.example.com/authorize',
  token_endpoint: 'https://auth.tracker.example.com/token',
};

export const trackerDiscovery = {
  kind: 'discovery#restDescription',
  name: 'tracker',
  version: 'v1',
  title: 'Tracker API',
  description: 'Reads and changes issues.',
  documentationLink: 'https://developers.example.com/tracker',
  rootUrl: 'https://tracker.example.com/',
  servicePath: 'tracker/',
  parameters: {
    fields: { type: 'string', location: 'query', description: 'Selector specifying which fields to include.' },
    alt: { type: 'string', location: 'query', default: 'json', enum: ['json', 'media'] },
    key: { type: 'string', location: 'query', description: 'API key.' },
  },
  auth: {
    oauth2: { scopes: { [readScope]: { description: 'Read issues' }, [writeScope]: { description: 'Change issues' } } },
  },
  schemas: {
    Issue: {
      id: 'Issue',
      type: 'object',
      properties: {
        name: { type: 'string', readOnly: true },
        state: { type: 'string', enum: ['OPEN', 'CLOSED'], enumDescriptions: ['Open', 'Closed'] },
        labels: { type: 'array', items: { $ref: 'Label' } },
        extra: { type: 'any', description: 'Anything.' },
      },
    },
    Label: { id: 'Label', type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false },
    ListIssuesResponse: {
      id: 'ListIssuesResponse',
      type: 'object',
      properties: { issues: { type: 'array', items: { $ref: 'Issue' } }, nextPageToken: { type: 'string' } },
    },
    Unused: { id: 'Unused', type: 'object' },
  },
  methods: {
    about: {
      id: 'tracker.about.get',
      path: 'v1/about/{version}',
      httpMethod: 'GET',
      parameters: {
        version: { type: 'string', location: 'path', required: true, description: 'The version.' },
        fields: { type: 'string', location: 'query', description: 'Its own fields.' },
      },
    },
  },
  resources: {
    projects: {
      resources: {
        issues: {
          methods: {
            list: {
              id: 'tracker.projects.issues.list',
              path: 'v1/{+parent}/issues',
              flatPath: 'v1/projects/{projectsId}/issues',
              httpMethod: 'GET',
              description: 'Lists issues.',
              parameterOrder: ['parent'],
              parameters: {
                parent: { type: 'string', location: 'path', required: true, description: 'The project.' },
                pageSize: { type: 'integer', format: 'int32', location: 'query', minimum: '1', maximum: '100' },
                labels: { type: 'string', location: 'query', repeated: true, description: 'Labels to match.' },
                query: { type: 'string', location: 'query', required: true, description: 'What to match.' },
              },
              response: { $ref: 'ListIssuesResponse' },
              scopes: [readScope, writeScope],
            },
            patch: {
              id: 'tracker.projects.issues.patch',
              path: 'v1/{+name}',
              flatPath: 'v1/projects/{projectsId}/issues/{issuesId}',
              httpMethod: 'PATCH',
              parameters: {
                name: issuePath,
                updateMask: { type: 'string', format: 'field-mask', location: 'query' },
              },
              request: { $ref: 'Issue' },
              response: { $ref: 'Issue' },
              scopes: [writeScope],
            },
            delete: {
              id: 'tracker.projects.issues.delete',
              path: 'v1/{+name}',
              flatPath: 'v1/projects/{projectsId}/issues/{issuesId}',
              httpMethod: 'DELETE',
              deprecated: true,
              parameters: { name: issuePath },
              scopes: [writeScope],
            },
            attach: {
              id: 'tracker.projects.issues.attach',
              path: 'v1/projects/{+projectId}/issues/{+issueId}:attach',
              flatPath: 'v1/projects/{projectsId}/issues/{issuesId}:attach',
              httpMethod: 'POST',
              supportsMediaUpload: true,
              mediaUpload: {
                protocols: { simple: { path: '/upload/tracker/v1/projects/{+projectId}/issues/{+issueId}:attach' } },
              },
              parameters: {
                projectId: { ...singleSegmentPath, description: 'The project.' },
                issueId: { ...singleSegmentPath, description: 'The issue.' },
              },
              scopes: [writeScope],
            },
          },
        },
      },
    },
  },
};

export const fieldsParameter = {
  name: 'fields',
  in: 'query',
  description: 'Selector specifying which fields to include.',
  schema: { type: 'string' },
};

const projectAndIssue = [
  { name: 'projectsId', in: 'path', required: true, schema: { type: 'string' } },
  { name: 'issuesId', in: 'path', required: true, schema: { type: 'string' } },
];

const onlyWrite = [{ oauth2: [writeScope] }];

export const trackerCurated = {
  openapi: '3.1.0',
  info: { title: 'Tracker API', version: 'v1', description: 'Reads and changes issues.' },
  externalDocs: { url: 'https://developers.example.com/tracker' },
  servers: [{ url: 'https://tracker.example.com/tracker' }],
  paths: {
    '/v1/projects/{projectsId}/issues': {
      get: {
        operationId: 'tracker.projects.issues.list',
        description: 'Lists issues.',
        parameters: [
          { name: 'projectsId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', format: 'int32', minimum: 1, maximum: 100 } },
          {
            name: 'labels',
            in: 'query',
            description: 'Labels to match.',
            schema: { type: 'array', items: { type: 'string' } },
          },
          { name: 'query', in: 'query', required: true, description: 'What to match.', schema: { type: 'string' } },
          fieldsParameter,
        ],
        responses: {
          '2XX': {
            description: 'ListIssuesResponse',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ListIssuesResponse' } } },
          },
        },
        security: [{ oauth2: [readScope] }, { oauth2: [writeScope] }],
      },
    },
    '/v1/projects/{projectsId}/issues/{issuesId}': {
      patch: {
        operationId: 'tracker.projects.issues.patch',
        parameters: [
          ...projectAndIssue,
          { name: 'updateMask', in: 'query', schema: { type: 'string', format: 'field-mask' } },
          fieldsParameter,
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } },
        },
        responses: {
          '2XX': {
            description: 'Issue',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } },
          },
        },
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
          {
            name: 'projectsId',
            in: 'path',
            required: true,
            description: 'The project.',
            schema: { type: 'string' },
          },
          {
            name: 'issuesId',
            in: 'path',
            required: true,
            description: 'The issue.',
            schema: { type: 'string' },
          },
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
      },
    },
  },
  components: {
    schemas: {
      Issue: {
        type: 'object',
        properties: {
          name: { type: 'string', readOnly: true },
          state: { type: 'string', enum: ['OPEN', 'CLOSED'] },
          labels: { type: 'array', items: { $ref: '#/components/schemas/Label' } },
          extra: { description: 'Anything.' },
        },
      },
      Label: { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false },
      ListIssuesResponse: {
        type: 'object',
        properties: {
          issues: { type: 'array', items: { $ref: '#/components/schemas/Issue' } },
          nextPageToken: { type: 'string' },
        },
      },
    },
    securitySchemes: trackerSecuritySchemes({ [readScope]: 'Read issues', [writeScope]: 'Change issues' }),
  },
};

export const trackerMethodIds = [
  'tracker.projects.issues.list',
  'tracker.projects.issues.patch',
  'tracker.projects.issues.delete',
  'tracker.projects.issues.attach',
  'tracker.about.get',
];

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
