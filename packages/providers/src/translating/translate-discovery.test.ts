import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  fieldsParameter,
  trackerAuthorizationServer,
  trackerCurated,
  trackerDiscovery,
  trackerMethodIds,
  trackerSecuritySchemes,
} from '../testing/discovery-documents.ts';
import { authorizationServerOf, discoveryDocumentOf } from './discovery-document.ts';
import { curatedDocumentOf, runTranslation } from './translate-discovery.ts';

const program = join(import.meta.dirname, 'translate-discovery.ts');

const server = authorizationServerOf(trackerAuthorizationServer);

interface Files {
  readonly source: string;
  readonly metadata: string;
  readonly target: string;
}

function withFiles(verify: (files: Files) => void | Promise<void>): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'translate-discovery-'));
  const files = {
    source: join(folder, 'tracker-v1.json'),
    metadata: join(folder, 'tracker-authorization-server.json'),
    target: join(folder, 'tracker.openapi.json'),
  };
  writeFileSync(files.source, JSON.stringify(trackerDiscovery));
  writeFileSync(files.metadata, JSON.stringify(trackerAuthorizationServer));
  return Promise.resolve(verify(files)).finally(() => {
    rmSync(folder, { recursive: true });
  });
}

describe('a curated document translated from a Discovery document', () => {
  it('holds the kept methods as operations on their flat paths, with their scopes, the fields parameter and the schemas they reach', () => {
    expect(
      curatedDocumentOf(discoveryDocumentOf(trackerDiscovery), server, [...trackerMethodIds, 'tracker.about.get']),
    ).toEqual(trackerCurated);
  });

  it('names no server path when the service has none, and no security scheme scopes when the document lists none', () => {
    const bare = { name: 'bare', version: 'v2', rootUrl: 'https://bare.example.com/', servicePath: '' };

    expect(curatedDocumentOf(discoveryDocumentOf(bare), server, [])).toEqual({
      openapi: '3.1.0',
      info: { title: 'bare', version: 'v2' },
      servers: [{ url: 'https://bare.example.com' }],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: trackerSecuritySchemes({}),
      },
    });
  });

  it('leaves out a bound that is not a number', () => {
    const unbounded = {
      ...trackerDiscovery,
      methods: {
        about: {
          id: 'tracker.about.get',
          path: 'v1/about',
          httpMethod: 'GET',
          parameters: { count: { type: 'integer', location: 'query', minimum: 'none' } },
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

  it('is refused for a schema the Discovery document refers to and does not have', () => {
    const dangling = {
      name: 'tracker',
      version: 'v1',
      rootUrl: 'https://tracker.example.com/',
      servicePath: '',
      methods: { about: { id: 'tracker.about.get', path: 'v1/about', httpMethod: 'GET', response: { $ref: 'About' } } },
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

describe('the translation command', () => {
  it('writes the curated document as indented JSON to the file it is given', () =>
    withFiles(async ({ source, metadata, target }) => {
      await runTranslation([source, metadata, target, ...trackerMethodIds]);

      const written = readFileSync(target, 'utf8');
      const curated = curatedDocumentOf(discoveryDocumentOf(trackerDiscovery), server, trackerMethodIds);
      expect(written).toBe(`${JSON.stringify(curated, null, 2)}\n`);
      expect(curated).toEqual(trackerCurated);
    }));

  it('runs as a program with the source, the metadata of the authorization server, the target and the method ids', () =>
    withFiles(({ source, metadata, target }) => {
      execFileSync(process.execPath, [program, source, metadata, target, 'tracker.about.get']);

      const written: unknown = JSON.parse(readFileSync(target, 'utf8'));
      expect(written).toHaveProperty(['paths', '/v1/about/{version}', 'get', 'operationId'], 'tracker.about.get');
      expect(written).not.toHaveProperty(['paths', '/v1/projects/{projectsId}/issues']);
    }));

  it('says how it is used when a source, the metadata, a target or a method id is missing', async () => {
    await expect(
      runTranslation(['tracker-v1.json', 'tracker-authorization-server.json', 'tracker.openapi.json']),
    ).rejects.toThrow(
      'Usage: node translate-discovery.ts <discovery document> <authorization server metadata> <curated document> <method id>...',
    );
  });
});
