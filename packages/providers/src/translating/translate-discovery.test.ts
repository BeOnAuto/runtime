import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { fieldsParameter, trackerCurated, trackerSecuritySchemes } from '../testing/curated-documents.ts';
import {
  trackerAuthorizationServer,
  trackerDiscovery,
  trackerMethodIds,
  trackerReadScope,
} from '../testing/discovery-documents.ts';
import { authorizationServerOf, discoveryDocumentOf } from './discovery-document.ts';
import { curatedDocumentOf } from './translate-discovery.ts';

const server = authorizationServerOf(trackerAuthorizationServer);

const pathsOf = Schema.decodeUnknownSync(Schema.Struct({ paths: Schema.Record(Schema.String, Schema.Unknown) }));

function reversed(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => reversed(item));
  }
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value)
          .map(([key, item]: readonly [string, unknown]) => [key, reversed(item)])
          .toReversed(),
      )
    : value;
}

describe('a curated document translated from a Discovery document', () => {
  it('holds the kept methods as operations on their flat paths, with their scopes, the fields parameter and the schemas they reach', () => {
    expect(
      curatedDocumentOf(discoveryDocumentOf(trackerDiscovery), server, [...trackerMethodIds, 'tracker.about.get']),
    ).toEqual(trackerCurated);
  });

  it('is written in the order of the methods kept, its query parameters, schemas, keywords and scopes by name, whatever order the Discovery document lists them in', () => {
    const translated = curatedDocumentOf(discoveryDocumentOf(trackerDiscovery), server, trackerMethodIds);
    const fromReversed = curatedDocumentOf(discoveryDocumentOf(reversed(trackerDiscovery)), server, trackerMethodIds);

    expect(JSON.stringify(fromReversed)).toBe(JSON.stringify(translated));
    expect(Object.keys(pathsOf(translated).paths)).toEqual([
      '/v1/projects/{projectsId}/issues',
      '/v1/projects/{projectsId}/issues/{issuesId}',
      '/v1/projects/{projectsId}/issues/{issuesId}:attach',
      '/v1/about/{version}',
    ]);
  });
});

describe('a curated document of a Discovery document that holds little', () => {
  it('names no server path when the service has none, and no security scheme scopes when the document lists none, and still requires the scheme of the document', () => {
    const bare = {
      name: 'bare',
      version: 'v2',
      revision: '20261019',
      rootUrl: 'https://bare.example.com/',
      servicePath: '',
    };

    expect(curatedDocumentOf(discoveryDocumentOf(bare), server, [])).toEqual({
      openapi: '3.1.0',
      info: { title: 'bare', version: 'v2' },
      servers: [{ url: 'https://bare.example.com' }],
      security: [{ oauth2: [] }],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: trackerSecuritySchemes({}),
      },
    });
  });
});

describe('a parameter of a curated document', () => {
  it('leaves out a bound that is not a number', () => {
    const unbounded = {
      ...trackerDiscovery,
      methods: {
        about: {
          id: 'tracker.about.get',
          path: 'v1/about',
          httpMethod: 'GET',
          parameters: { count: { type: 'integer', location: 'query', minimum: 'none' } },
          scopes: [trackerReadScope],
        },
      },
    };

    const { paths } = curatedDocumentOf(discoveryDocumentOf(unbounded), server, ['tracker.about.get']);

    expect(paths).toEqual({
      '/v1/about': {
        get: {
          operationId: 'tracker.about.get',
          parameters: [{ name: 'count', in: 'query', schema: { type: 'integer' } }, fieldsParameter],
          responses: { '2XX': { description: 'An empty body' } },
          security: [{ oauth2: [trackerReadScope] }],
        },
      },
    });
  });
});

describe('a curated document that is not made', () => {
  it('is refused for a method the Discovery document does not have', () => {
    expect(() =>
      curatedDocumentOf(discoveryDocumentOf(trackerDiscovery), server, ['tracker.issues.close', 'tracker.issues.open']),
    ).toThrow('The Discovery document has no method tracker.issues.close, tracker.issues.open');
  });

  it('is refused for a method kept whose Discovery method lists no scope, which a call would send no token for', () => {
    const unscoped = {
      name: 'tracker',
      version: 'v1',
      revision: '20261019',
      rootUrl: 'https://tracker.example.com/',
      servicePath: '',
      methods: { about: { id: 'tracker.about.get', path: 'v1/about', httpMethod: 'GET', scopes: [] } },
      resources: {
        ping: { methods: { get: { id: 'tracker.ping.get', path: 'v1/ping', httpMethod: 'GET' } } },
      },
    };

    expect(() =>
      curatedDocumentOf(discoveryDocumentOf(unscoped), server, ['tracker.about.get', 'tracker.ping.get']),
    ).toThrow(
      'The Discovery document lists no scope for the method tracker.about.get, tracker.ping.get, so a call of it would send no token',
    );
  });
});

describe('a curated document of a Discovery document that is not whole', () => {
  it('is refused for a schema the Discovery document refers to and does not have', () => {
    const dangling = {
      name: 'tracker',
      version: 'v1',
      revision: '20261019',
      rootUrl: 'https://tracker.example.com/',
      servicePath: '',
      methods: {
        about: {
          id: 'tracker.about.get',
          path: 'v1/about',
          httpMethod: 'GET',
          response: { $ref: 'About' },
          scopes: [trackerReadScope],
        },
      },
    };

    expect(() => curatedDocumentOf(discoveryDocumentOf(dangling), server, ['tracker.about.get'])).toThrow(
      'The Discovery document refers to the schema About, which it does not have',
    );
  });

  it('is not made from a document that is not a Discovery document, nor from metadata without its endpoints', () => {
    expect(() => discoveryDocumentOf({ openapi: '3.1.0' })).toThrow('Missing key');
    expect(() => authorizationServerOf({ issuer: 'https://auth.tracker.example.com' })).toThrow('Missing key');
  });
});
