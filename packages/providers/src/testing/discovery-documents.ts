export const trackerReadScope = 'https://tracker.example.com/auth/read';

export const trackerWriteScope = 'https://tracker.example.com/auth/write';

const singleSegmentPath = { type: 'string', location: 'path', required: true, pattern: '^[^/]+$' };

const issuePath = { type: 'string', location: 'path', required: true, pattern: '^projects/[^/]+/issues/[^/]+$' };

const projectPath = { type: 'string', location: 'path', required: true, description: 'The project.' };

export const trackerAuthorizationServer = {
  issuer: 'https://auth.tracker.example.com',
  authorization_endpoint: 'https://auth.tracker.example.com/authorize',
  token_endpoint: 'https://auth.tracker.example.com/token',
};

export const trackerDiscovery = {
  kind: 'discovery#restDescription',
  name: 'tracker',
  version: 'v1',
  revision: '20261019',
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
    oauth2: {
      scopes: {
        [trackerWriteScope]: { description: 'Change issues' },
        [trackerReadScope]: { description: 'Read issues' },
      },
    },
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
    IssueOperation: {
      id: 'IssueOperation',
      type: 'object',
      description: 'A change of an issue.',
      properties: {
        create: { $ref: 'Issue', description: 'The issue to create.' },
        update: { $ref: 'Issue' },
        remove: { type: 'string' },
      },
    },
    LabelOperation: { id: 'LabelOperation', type: 'object', properties: { create: { $ref: 'Label' } } },
    MutateOperation: {
      id: 'MutateOperation',
      type: 'object',
      description: 'One change.',
      properties: { labelOperation: { $ref: 'LabelOperation' }, issueOperation: { $ref: 'IssueOperation' } },
    },
    MutateIssuesRequest: {
      id: 'MutateIssuesRequest',
      type: 'object',
      properties: { operations: { type: 'array', items: { $ref: 'MutateOperation' } } },
    },
    MutateIssuesResponse: {
      id: 'MutateIssuesResponse',
      type: 'object',
      properties: { issues: { type: 'array', items: { $ref: 'Issue' } } },
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
      scopes: [trackerReadScope],
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
                parent: projectPath,
                query: { type: 'string', location: 'query', required: true, description: 'What to match.' },
                pageSize: { type: 'integer', format: 'int32', location: 'query', minimum: '1', maximum: '100' },
                labels: { type: 'string', location: 'query', repeated: true, description: 'Labels to match.' },
              },
              response: { $ref: 'ListIssuesResponse' },
              scopes: [trackerReadScope, trackerWriteScope],
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
              scopes: [trackerWriteScope],
            },
            delete: {
              id: 'tracker.projects.issues.delete',
              path: 'v1/{+name}',
              flatPath: 'v1/projects/{projectsId}/issues/{issuesId}',
              httpMethod: 'DELETE',
              deprecated: true,
              parameters: { name: issuePath },
              scopes: [trackerWriteScope],
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
              scopes: [trackerWriteScope],
            },
            mutate: {
              id: 'tracker.projects.issues.mutate',
              path: 'v1/{+parent}/issues:mutate',
              flatPath: 'v1/projects/{projectsId}/issues:mutate',
              httpMethod: 'POST',
              parameters: { parent: projectPath },
              request: { $ref: 'MutateIssuesRequest' },
              response: { $ref: 'MutateIssuesResponse' },
              scopes: [trackerWriteScope],
            },
          },
        },
      },
    },
  },
};

export const trackerMethodIds = [
  'tracker.projects.issues.list',
  'tracker.projects.issues.patch',
  'tracker.projects.issues.delete',
  'tracker.projects.issues.attach',
  'tracker.about.get',
];

export const trackerMutateId = 'tracker.projects.issues.mutate';

const trackerCuts = [
  {
    schema: 'Issue',
    writable_in: { IssueOperation: ['create', 'update'] },
    leaves_out: ['extra'],
    because: 'what anything holds',
  },
  { schema: 'Label', writable_in: { LabelOperation: ['create'] }, leaves_out: [] },
  {
    schema: 'MutateOperation',
    keeps: ['issueOperation', 'labelOperation'],
    holds: 'the changes of issues and labels',
  },
];

export const trackerManifest = {
  discovery: 'https://tracker.example.com/$discovery/rest?version=v1',
  revision: '20261001',
  authorization_server: 'https://auth.tracker.example.com/.well-known/oauth-authorization-server',
  methods: [...trackerMethodIds, trackerMutateId],
  cuts: trackerCuts,
};
