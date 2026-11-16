import { shippedFilesInMemory } from '@on.auto/shipped-files/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { fieldsParameter } from '../testing/curated-documents.ts';
import {
  trackerAuthorizationServer,
  trackerDiscovery,
  trackerImportId,
  trackerManifest,
  trackerWriteScope,
} from '../testing/discovery-documents.ts';
import { discoveryDocumentOf } from './discovery-document.ts';
import { translatedDocuments } from './document-manifests.ts';
import { authorizationServerOf } from './oauth2-scheme.ts';
import { curatedDocumentOf } from './translate-discovery.ts';

const server = authorizationServerOf(trackerAuthorizationServer);

const listId = 'tracker.projects.issues.list';

const importUploadId = `${trackerImportId}.upload`;

const uploadPath = '/upload/tracker/v1/projects/{projectId}/issues:import';

const decodeCurated = Schema.decodeUnknownSync(
  Schema.Struct({
    openapi: Schema.String,
    servers: Schema.Array(Schema.Struct({ url: Schema.String })),
    paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
  }),
);

const issueContent = { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } };

const uploadOperation = {
  operationId: importUploadId,
  description: 'Imports an issue from a file.',
  parameters: [
    { name: 'projectId', in: 'path', required: true, description: 'The project.', schema: { type: 'string' } },
    {
      name: 'uploadType',
      in: 'query',
      required: true,
      description: 'Legacy upload protocol for media.',
      schema: { enum: ['multipart'], type: 'string' },
    },
    fieldsParameter,
  ],
  requestBody: {
    required: true,
    content: {
      'multipart/related': {
        schema: { type: 'array', prefixItems: [{ $ref: '#/components/schemas/Issue' }, {}], minItems: 2, items: false },
        prefixEncoding: [{ contentType: 'application/json' }, { contentType: 'text/csv, text/plain' }],
      },
    },
  },
  responses: { '2XX': { description: 'Issue', content: issueContent } },
  security: [{ oauth2: [trackerWriteScope] }],
};

const uploadDescription = {
  operation: importUploadId,
  says: 'Imports an issue from a file.',
  because: 'its own words',
};

const descriptions = [
  uploadDescription,
  { operation: listId, says: 'Lists the issues of a project.', because: 'shorter' },
];

function uploading(discovery: unknown, uploads: readonly string[], methods: readonly string[] = [listId, ...uploads]) {
  return curatedDocumentOf(discoveryDocumentOf(discovery), server, methods, { uploads });
}

const curated = decodeCurated(
  curatedDocumentOf(discoveryDocumentOf(trackerDiscovery), server, [listId, trackerImportId], {
    uploads: [trackerImportId],
    descriptions,
  }),
);

describe('a curated document that keeps the upload of a method', () => {
  it('is of OpenAPI 3.2, at the root of the service, each path with the service path, the upload at its own', () => {
    expect([curated.openapi, curated.servers]).toEqual(['3.2.0', [{ url: 'https://tracker.example.com' }]]);
    expect(Object.keys(curated.paths)).toEqual([
      '/tracker/v1/projects/{projectsId}/issues',
      '/tracker/v1/projects/{projectsId}/issues:import',
      uploadPath,
    ]);
  });

  it('writes the upload as an operation of its own: its metadata JSON first, its media after, its upload type pinned', () => {
    expect(curated.paths[uploadPath]).toEqual({ post: uploadOperation });
  });

  it("describes an operation in the words of the manifest where it gives them, and in the vendor's elsewhere", () => {
    expect(curated.paths['/tracker/v1/projects/{projectsId}/issues:import']?.['post']).toMatchObject({
      operationId: trackerImportId,
      description: 'Imports an issue. This method supports an /upload URI.',
    });
    expect(curated.paths['/tracker/v1/projects/{projectsId}/issues']?.['get']).toMatchObject({
      description: 'Lists the issues of a project.',
    });
  });
});

describe('the media part of an upload whose Discovery method names no type it accepts', () => {
  it('is written with no type, which OpenAPI then reads as any bytes', () => {
    const unnamed = {
      ...trackerDiscovery,
      methods: {
        send: {
          id: 'tracker.send',
          path: 'v1/send',
          httpMethod: 'POST',
          mediaUpload: { protocols: { simple: { path: '/upload/tracker/v1/send', multipart: true } } },
          request: { $ref: 'Label' },
          scopes: [trackerWriteScope],
        },
      },
    };

    const { paths } = decodeCurated(uploading(unnamed, ['tracker.send'], ['tracker.send']));

    expect(paths['/upload/tracker/v1/send']?.['post']).toMatchObject({
      requestBody: { content: { 'multipart/related': { prefixEncoding: [{ contentType: 'application/json' }, {}] } } },
    });
  });
});

describe('a curated document that keeps an upload it cannot write', () => {
  it('is refused for an upload of a method it does not keep, or of a method that uploads no metadata with its media', () => {
    expect(() => uploading(trackerDiscovery, [trackerImportId], [listId])).toThrow(
      `The manifest keeps the upload of ${trackerImportId}, and not the method itself`,
    );
    expect(() => uploading(trackerDiscovery, ['tracker.projects.issues.attach'])).toThrow(
      'The method tracker.projects.issues.attach of the Discovery document takes no metadata beside its media, which the upload kept sends first',
    );
    expect(() => uploading(trackerDiscovery, ['tracker.projects.issues.patch'])).toThrow(
      'The method tracker.projects.issues.patch of the Discovery document uploads no media in one request, which the upload kept sends',
    );
  });

  it('is refused where the Discovery document names no upload type, or the manifest describes an operation not there', () => {
    const { parameters: _, ...withoutParameters } = trackerDiscovery;

    expect(() => uploading(withoutParameters, [trackerImportId])).toThrow(
      'The Discovery document has no global parameter uploadType, which an upload sends',
    );
    expect(() =>
      curatedDocumentOf(discoveryDocumentOf(trackerDiscovery), server, [listId], {
        descriptions: [{ operation: `${listId}.upload`, says: 'Uploads.', because: 'none' }],
      }),
    ).toThrow(`The manifest describes the operation ${listId}.upload, which the document does not hold`);
  });
});

describe('a manifest that keeps an upload and writes descriptions', () => {
  it('is written again as it is, at the revision read, beside the document of OpenAPI 3.2', async () => {
    const { cuts: _, ...uncut } = trackerManifest;
    const manifest = {
      ...uncut,
      methods: [trackerImportId],
      uploads: [trackerImportId],
      descriptions: [uploadDescription],
    };
    const folder = { package: '@acme/shipped', path: 'documents' };
    const answers = new Map<string, unknown>([
      [trackerManifest.discovery, trackerDiscovery],
      [trackerManifest.authorization_server, trackerAuthorizationServer],
    ]);

    const written = await translatedDocuments([], {
      folder,
      shippedFiles: shippedFilesInMemory({
        [folder.package]: { 'documents/tracker.manifest.json': JSON.stringify(manifest) },
      }),
      fetching: (address) => Promise.resolve(Response.json(answers.get(address))),
      readGiven: () => Promise.reject(new Error('Nothing is given')),
    });
    const [document, remade] = written.map(({ text }): unknown => JSON.parse(text));

    expect(remade).toEqual({ ...manifest, revision: trackerDiscovery.revision });
    expect(document).toMatchObject({ openapi: '3.2.0', servers: [{ url: 'https://tracker.example.com' }] });
  });
});
