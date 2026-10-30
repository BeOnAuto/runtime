import { Redacted, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf, toolsOf } from '../api-testing/derived-documents.ts';
import { decodedDocument } from './api-document.ts';
import { securityProblemsOf, type Presented, type SecuredEntry } from './security-schemes.ts';

const key = Redacted.make('billing-api-key-7c1d4e9a');

const schemes: Schema.JsonObject = {
  headerKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
  queryKey: { type: 'apiKey', in: 'query', name: 'api_key' },
  bearer: { type: 'http', scheme: 'Bearer' },
  basic: { type: 'http', scheme: 'basic' },
  digest: { type: 'http', scheme: 'digest' },
  cookieKey: { type: 'apiKey', in: 'cookie', name: 'session' },
  mtls: { type: 'mutualTLS' },
  clients: { type: 'oauth2', flows: {} },
  people: { type: 'openIdConnect', openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration' },
};

function presented(names: readonly string[], auth = false): Presented {
  return { security: new Map(names.map((name) => [name, key])), auth, headers: new Set() };
}

function securedDocument(paths: Schema.JsonObject, security?: Schema.Json): Readonly<Record<string, Schema.Json>> {
  return documentOf(paths, {
    components: { securitySchemes: schemes },
    ...(security === undefined ? {} : { security }),
  });
}

function credentialsOf(paths: Schema.JsonObject, given: Presented, security?: Schema.Json) {
  const { operations, leftOut } = toolsOf(securedDocument(paths, security), given);
  return { offered: operations.map(({ tool, credentials }) => [tool.name, credentials]), leftOut };
}

describe('the requirements of an operation of an HTTP API', () => {
  it('send the credentials of the first alternative the entry gives, in the order of the document, and no other', () => {
    const paths = { '/a': { get: { operationId: 'a', security: [{ headerKey: [] }, { queryKey: [], bearer: [] }] } } };

    expect(credentialsOf(paths, presented(['queryKey', 'bearer', 'basic'])).offered).toEqual([
      [
        'a',
        [
          { kind: 'query', name: 'api_key', value: key },
          { kind: 'bearer', value: key },
        ],
      ],
    ]);
    expect(credentialsOf(paths, presented(['headerKey', 'queryKey', 'bearer'])).offered).toEqual([
      ['a', [{ kind: 'header', name: 'X-Api-Key', value: key }]],
    ]);
  });

  it('leave out an operation whose every alternative needs a scheme the entry does not give, naming the schemes', () => {
    const paths = { '/a': { get: { operationId: 'a', security: [{ headerKey: [] }, { basic: [], clients: [] }] } } };

    expect(credentialsOf(paths, presented(['basic']))).toEqual({
      offered: [],
      leftOut: [
        {
          operation: 'a (GET /a)',
          because:
            'it needs the security scheme headerKey, or basic with clients of the document, which the security and the auth of the entry do not give',
        },
      ],
    });
  });

  it('send no credential for an empty requirement, an empty alternative, or a document that requires none', () => {
    const paths = {
      '/a': { get: { operationId: 'a', security: [] } },
      '/b': { get: { operationId: 'b', security: [{ headerKey: [] }, {}] } },
    };

    expect(credentialsOf(paths, presented([]), [{ headerKey: [] }]).offered).toEqual([
      ['a', []],
      ['b', []],
    ]);
    expect(toolsOf(documentOf({ '/c': { get: { operationId: 'c' } } }), presented([])).operations).toMatchObject([
      { tool: { name: 'c' }, credentials: [] },
    ]);
  });
});

const needsTheKey = { parameters: [{ name: 'x-api-key', in: 'header', required: true }] };

describe('a header an operation of an HTTP API needs, which its security places', () => {
  it('is met by the key of the alternative that places it, its own or that of the document, before an earlier one', () => {
    const paths = {
      '/a': { get: { operationId: 'a', security: [{ headerKey: [] }], ...needsTheKey } },
      '/b': { get: { operationId: 'b', security: [{ bearer: [] }, { headerKey: [] }], ...needsTheKey } },
      '/c': { get: { operationId: 'c', ...needsTheKey } },
    };
    const sentKey = [{ kind: 'header', name: 'X-Api-Key', value: key }];

    expect(credentialsOf(paths, presented(['headerKey', 'bearer']), [{ headerKey: [] }])).toEqual({
      offered: [
        ['a', sentKey],
        ['b', sentKey],
        ['c', sentKey],
      ],
      leftOut: [],
    });
  });

  it('is not met by an alternative that places no such header, the only one the entry gives', () => {
    const paths = {
      '/b': { get: { operationId: 'b', security: [{ bearer: [] }, { headerKey: [] }], ...needsTheKey } },
    };

    expect(credentialsOf(paths, presented(['bearer'])).leftOut).toEqual([
      {
        operation: 'b (GET /b)',
        because: 'it needs the header x-api-key, which a function cannot send; the headers of the entry can give it',
      },
    ]);
  });

  it('leaves its operation out in the words of its security where the entry gives none of it', () => {
    const paths = { '/a': { get: { operationId: 'a', security: [{ headerKey: [] }], ...needsTheKey } } };

    expect(credentialsOf(paths, presented([])).leftOut).toEqual([
      {
        operation: 'a (GET /a)',
        because:
          'it needs the security scheme headerKey of the document, which the security and the auth of the entry do not give',
      },
    ]);
  });
});

describe('the headers an operation of an HTTP API needs beyond what its security places', () => {
  it('chooses the key that places one of two headers it needs, and names the other where it leaves it out', () => {
    const security = [{ bearer: [] }, { headerKey: [] }];
    const required = { in: 'header', required: true };
    const paths = {
      '/a': { get: { operationId: 'a', security, ...needsTheKey } },
      '/b': {
        get: { operationId: 'b', security, parameters: [...needsTheKey.parameters, { name: 'X-Tenant', ...required }] },
      },
      '/c': {
        get: { operationId: 'c', security, parameters: [...needsTheKey.parameters, { name: 'Host', ...required }] },
      },
    };

    expect(credentialsOf(paths, presented(['headerKey', 'bearer']))).toEqual({
      offered: [['a', [{ kind: 'header', name: 'X-Api-Key', value: key }]]],
      leftOut: [
        {
          operation: 'b (GET /b)',
          because: 'it needs the header X-Tenant, which a function cannot send; the headers of the entry can give it',
        },
        {
          operation: 'c (GET /c)',
          because:
            'it needs the header Host, which the runtime sets itself and neither a function nor the headers of the entry can give',
        },
      ],
    });
  });
});

describe('the requirements an operation of an HTTP API takes from its document and its auth block', () => {
  it('take the requirement of the document where an operation has none, and the operation’s own where it has one', () => {
    const paths = {
      '/a': { get: { operationId: 'a' } },
      '/b': { get: { operationId: 'b', security: [{ queryKey: [] }] } },
    };

    expect(credentialsOf(paths, presented(['headerKey', 'queryKey']), [{ headerKey: [] }]).offered).toEqual([
      ['a', [{ kind: 'header', name: 'X-Api-Key', value: key }]],
      ['b', [{ kind: 'query', name: 'api_key', value: key }]],
    ]);
  });

  it('are met by the auth block alone for an oauth2 or openIdConnect scheme, its token sent once', () => {
    const paths = {
      '/a': { get: { operationId: 'a', security: [{ clients: ['read'], people: [] }] } },
      '/b': { get: { operationId: 'b', security: [{ cookieKey: [] }, { mtls: [] }, { digest: [] }, { missing: [] }] } },
    };

    expect(credentialsOf(paths, presented(['cookieKey', 'mtls', 'digest', 'missing'], true))).toMatchObject({
      offered: [['a', [{ kind: 'token' }]]],
      leftOut: [{ operation: 'b (GET /b)' }],
    });
    expect(credentialsOf(paths, presented([])).leftOut).toHaveLength(2);
  });
});

function entryWith(security: Readonly<Record<string, string>>, more: Partial<SecuredEntry> = {}): SecuredEntry {
  return {
    security: new Map(
      Object.entries(security).map(([name, written]: readonly [string, string]) => [name, Redacted.make(written)]),
    ),
    headers: new Map(),
    query_params: new Map(),
    auth: null,
    ...more,
  };
}

function problemsOfEntry(entry: SecuredEntry, declared: Schema.JsonObject = schemes): readonly unknown[] {
  const read = Result.getOrThrow(decodedDocument(documentOf({}, { components: { securitySchemes: declared } })));
  return securityProblemsOf(entry, read.document);
}

const value = 'billing-api-key-7c1d4e9a';

describe('the security of an entry, refused at start', () => {
  it('names a scheme the document does not declare, a cookie, an http scheme other than bearer and basic, and mutualTLS', () => {
    expect(problemsOfEntry(entryWith({ unknown: value, cookieKey: value, digest: value, mtls: value }))).toEqual([
      {
        path: ['security', 'unknown'],
        detail:
          'The document declares no security scheme of this name; it declares headerKey, queryKey, bearer, basic, digest, cookieKey, mtls, clients, people',
      },
      {
        path: ['security', 'cookieKey'],
        detail: 'An apiKey the document places in a cookie, which a call does not send',
      },
      {
        path: ['security', 'digest'],
        detail: 'An http scheme of digest, which a call does not send; a call sends bearer and basic',
      },
      { path: ['security', 'mtls'], detail: 'A mutualTLS scheme, whose certificate a call does not present' },
    ]);
    expect(problemsOfEntry(entryWith({ unknown: value }), {})).toMatchObject([
      { detail: 'The document declares no security scheme of this name; it declares none' },
    ]);
  });
});

describe('the security of an entry, refused at start for what it gives', () => {
  it('names an oauth2 or openIdConnect scheme given a value, and a basic one without user:password', () => {
    expect(problemsOfEntry(entryWith({ clients: value, people: value, basic: value }), schemes)).toEqual([
      {
        path: ['security', 'clients'],
        detail:
          'An oauth2 scheme, which the auth block of the entry satisfies with the token it mints; its credential is the client, not a value of security',
      },
      {
        path: ['security', 'people'],
        detail:
          'An openIdConnect scheme, which the auth block of the entry satisfies with the token it mints; its credential is the client, not a value of security',
      },
      { path: ['security', 'basic'], detail: 'Expected user:password, which a basic scheme sends' },
    ]);
  });
});

const bearerSchemes: Schema.JsonObject = {
  headerKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
  queryKey: { type: 'apiKey', in: 'query', name: 'api_key' },
  bearer: { type: 'http', scheme: 'bearer' },
  basic: { type: 'http', scheme: 'basic' },
};

describe('the security of an entry, refused at start beside the rest of it', () => {
  it('names a header or a query parameter of the entry that a scheme it gives places, and an auth block no scheme asks for', () => {
    const entry = entryWith(
      { headerKey: value, bearer: value, queryKey: value, basic: `ada:${value}` },
      {
        headers: new Map([
          ['x-api-key', key],
          ['X-Tenant', key],
          ['Authorization', key],
        ]),
        query_params: new Map([
          ['api_key', key],
          ['tenant', key],
        ]),
        auth: {},
      },
    );

    expect(problemsOfEntry(entry, bearerSchemes)).toEqual([
      {
        path: ['headers', 'x-api-key'],
        detail: 'Placed by the security scheme headerKey; give the credential under security alone',
      },
      {
        path: ['headers', 'Authorization'],
        detail: 'Placed by the security scheme basic; give the credential under security alone',
      },
      {
        path: ['query_params', 'api_key'],
        detail: 'Placed by the security scheme queryKey; give the credential under security alone',
      },
      {
        path: ['auth'],
        detail:
          'The document declares no oauth2 or openIdConnect scheme, so no call would send the token this block mints',
      },
    ]);
    expect(problemsOfEntry(entryWith({ headerKey: value }, { auth: {} }))).toEqual([]);
  });
});
