import { trackerAuthorizationServer } from './discovery-documents.ts';

export const peopleAddress = 'https://developers.tracker.example.com/api/people/';

export const issuesAddress = 'https://developers.tracker.example.com/api/issues/';

export const aboutAddress = 'https://developers.tracker.example.com/api/about/';

const trackerMetadataAddress = 'https://auth.tracker.example.com/.well-known/oauth-authorization-server';

const servers = [{ url: 'https://api.tracker.example.com/v2' }];

const bearer = [{ vendor_bearer: [] }];

const vendorSchemes = { vendor_bearer: { type: 'http', scheme: 'bearer' } };

function answered(description: string) {
  return { 200: { description, content: { 'application/json': { schema: { type: 'object' } } } } };
}

function scoped(...scopes: readonly string[]) {
  return { 'x-permissions': ['Tracker:Read'], 'x-granular-scopes': scopes };
}

const userId = { name: 'userId', in: 'path', required: true, schema: { type: 'string' } };

const issueId = { name: 'issueId', in: 'path', required: true, schema: { type: 'string' } };

const pageSize = { name: 'page_size', in: 'query', schema: { type: 'integer' } };

const includeFields = { name: 'include_fields', in: 'query', schema: { type: 'string', example: 'download_token' } };

const ttl = { name: 'ttl', in: 'query', schema: { type: 'integer' } };

const loginType = { name: 'login_type', in: 'query', schema: { type: 'integer' } };

const expand = { $ref: '#/components/parameters/expand' };

const expandParameter = { name: 'expand', in: 'query', schema: { $ref: '#/components/schemas/Expansion' } };

const expansion = { type: 'string', enum: ['comments', 'labels'] };

const oneOfAddresses = [
  { type: 'string', format: 'email' },
  { type: 'string', example: 'a7Bc9' },
];

function issueBody(assignee: unknown, watchers: unknown) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: 200 },
            assignee,
            watchers: { type: 'array', items: { type: 'object', properties: { watcher: watchers } } },
          },
        },
      },
    },
  };
}

export const peopleSource = {
  openapi: '3.0.0',
  info: { title: 'People API', version: '2' },
  servers,
  paths: {
    '/users/{userId}': {
      get: {
        tags: ['People'],
        summary: 'Get a person',
        operationId: 'person',
        parameters: [userId, loginType],
        responses: answered('The person'),
        security: bearer,
        'x-extensions': scoped('user:read:user', 'user:read:user:admin'),
      },
    },
    '/users': {
      get: {
        operationId: 'people',
        responses: answered('The people'),
        security: bearer,
        'x-extensions': scoped('user:read:list_users:admin'),
      },
    },
  },
  components: { securitySchemes: vendorSchemes },
};

export const issuesSource = {
  openapi: '3.0.0',
  info: { title: 'Issues API', version: '2' },
  servers,
  paths: {
    '/users/{userId}/issues': {
      summary: 'The issues of a person',
      get: {
        tags: ['Issues'],
        operationId: 'issues',
        parameters: [userId, pageSize, expand],
        responses: answered('The issues'),
        security: bearer,
        'x-extensions': scoped('issue:read:list_issues', 'issue:read:list_issues:admin'),
        'x-rate-limit': 'LIGHT',
      },
      post: {
        tags: ['Issues'],
        operationId: 'issueCreate',
        parameters: [userId],
        requestBody: issueBody(
          { description: 'Who the issue is for', oneOf: oneOfAddresses },
          { oneOf: oneOfAddresses },
        ),
        responses: answered('The issue made'),
        security: bearer,
        'x-extensions': scoped('issue:write:issue:admin', 'issue:write:issue', 'issue:write:issue:master'),
      },
    },
    '/issues/{issueId}': {
      get: {
        tags: ['Issues'],
        operationId: 'issue',
        parameters: [issueId, includeFields, ttl, expand],
        responses: answered('The issue'),
        security: bearer,
        'x-extensions': scoped('issue:read:issue', 'issue:read:issue:admin'),
      },
      delete: {
        operationId: 'issueDelete',
        parameters: [issueId],
        responses: { 204: { description: 'Deleted' } },
        security: bearer,
        'x-extensions': scoped('issue:delete:issue'),
      },
    },
  },
  components: {
    parameters: { expand: expandParameter, unreached: pageSize },
    schemas: { Expansion: expansion, Unreached: { type: 'object' } },
    securitySchemes: vendorSchemes,
  },
};

const scheme = {
  name: 'tracker_oauth',
  scopes_at: ['x-extensions', 'x-granular-scopes'],
  leaving_out: [':admin', ':master'],
  because: 'A person grants the user-level scopes alone',
};

const info = {
  title: 'Tracker people and issues',
  version: '2',
  description: 'Four operations translated from the people and issues documents.',
};

export const trackerOpenApiManifest = {
  type: 'openapi',
  sources: [peopleAddress, issuesAddress],
  authorization_server: trackerMetadataAddress,
  info,
  operations: ['person', 'issues', 'issue', 'issueCreate'],
  path_values: [{ parameter: 'userId', value: 'me', because: 'A user-level app passes me' }],
  left_out_parameters: [
    { operation: 'issue', parameters: ['include_fields', 'ttl'], because: 'So no download token reaches an answer' },
  ],
  single_strings: [
    { operation: 'issueCreate', at: '/properties/assignee', because: 'No string matches exactly one of its strings' },
    {
      operation: 'issueCreate',
      at: '/properties/watchers/items/properties/watcher',
      because: 'No string matches exactly one of its strings',
    },
  ],
  scheme,
  keeps_responses: true,
};

function required(...scopes: readonly string[]) {
  return scopes.map((scope) => ({ tracker_oauth: [scope] }));
}

function trackerSchemesOf(scopes: Readonly<Record<string, string>>) {
  return {
    tracker_oauth: {
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

export const trackerOpenApiTranslated = {
  openapi: '3.0.0',
  info,
  servers,
  security: [{ tracker_oauth: [] }],
  paths: {
    '/users/me': {
      get: {
        tags: ['People'],
        summary: 'Get a person',
        operationId: 'person',
        parameters: [loginType],
        responses: answered('The person'),
        security: required('user:read:user'),
      },
    },
    '/users/me/issues': {
      get: {
        tags: ['Issues'],
        operationId: 'issues',
        parameters: [pageSize, expand],
        responses: answered('The issues'),
        security: required('issue:read:list_issues'),
      },
      post: {
        tags: ['Issues'],
        operationId: 'issueCreate',
        parameters: [],
        requestBody: issueBody({ type: 'string', description: 'Who the issue is for' }, { type: 'string' }),
        responses: answered('The issue made'),
        security: required('issue:write:issue'),
      },
    },
    '/issues/{issueId}': {
      get: {
        tags: ['Issues'],
        operationId: 'issue',
        parameters: [issueId, expand],
        responses: answered('The issue'),
        security: required('issue:read:issue'),
      },
    },
  },
  components: {
    parameters: { expand: expandParameter },
    schemas: { Expansion: expansion },
    securitySchemes: trackerSchemesOf({
      'issue:read:issue': 'issue:read:issue',
      'issue:read:list_issues': 'issue:read:list_issues',
      'issue:write:issue': 'issue:write:issue',
      'user:read:user': 'user:read:user',
    }),
  },
};

export const aboutSource = {
  openapi: '3.1.0',
  paths: {
    '/about': {
      get: {
        operationId: 'about',
        responses: answered('What the tracker is'),
        'x-extensions': scoped('about:read'),
      },
    },
  },
};

export const aboutManifest = {
  type: 'openapi',
  sources: [aboutAddress],
  authorization_server: trackerMetadataAddress,
  info,
  operations: ['about'],
  scheme,
  keeps_responses: false,
};

export const aboutTranslated = {
  openapi: '3.1.0',
  info,
  security: [{ tracker_oauth: [] }],
  paths: {
    '/about': {
      get: {
        operationId: 'about',
        responses: { default: { description: 'An answer this document does not describe' } },
        security: required('about:read'),
      },
    },
  },
  components: { securitySchemes: trackerSchemesOf({ 'about:read': 'about:read' }) },
};
