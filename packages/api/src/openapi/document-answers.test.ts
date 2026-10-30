import { makeCatalog } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { blobOperations } from '../testing/blob-operations.ts';
import { testShelf } from '../testing/guides.ts';
import { listNotesOfTheOrg, notebookOperations } from '../testing/notebook.ts';
import { operationsIn } from '../testing/openapi/openapi-document.ts';
import { testIdentityIssuer, testServerInfo } from '../testing/operation-server.ts';
import { openApiDocumentOf } from './openapi-document.ts';

const document = openApiDocumentOf(
  makeCatalog([...notebookOperations, listNotesOfTheOrg, ...blobOperations]),
  testServerInfo,
  testShelf,
  testIdentityIssuer,
);

const ComponentsSchema = Schema.Struct({
  tags: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.optionalKey(Schema.String) })),
  components: Schema.Struct({
    responses: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
    parameters: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
    securitySchemes: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
  }),
});

const { tags, components } = Schema.decodeUnknownSync(ComponentsSchema)(document);

function responsesOf(id: string): Readonly<Record<string, unknown>> {
  return operationsIn(document).find(({ operation }) => operation.operationId === id)?.operation.responses ?? {};
}

const problemContent = { 'application/problem+json': { schema: { $ref: '#/components/schemas/problem' } } };

const answeredByEveryOperation = {
  400: { $ref: '#/components/responses/bad_request' },
  401: { $ref: '#/components/responses/unauthenticated' },
  403: { $ref: '#/components/responses/forbidden_or_origin_not_allowed' },
  404: { $ref: '#/components/responses/not_found' },
  405: { $ref: '#/components/responses/method_not_allowed' },
  413: { $ref: '#/components/responses/content_too_large' },
  415: { $ref: '#/components/responses/unsupported_media_type' },
  422: { $ref: '#/components/responses/invalid_input' },
  500: { $ref: '#/components/responses/internal' },
  503: { $ref: '#/components/responses/unavailable' },
};

describe('the answers of an operation', () => {
  it('are its success with its output schema, and the problems every operation answers, by reference', () => {
    const { 200: success, ...problems } = responsesOf('list_labels');

    expect(success).toMatchObject({ description: 'Succeeded', content: { 'application/json': { schema: {} } } });
    expect(problems).toEqual(answeredByEveryOperation);
  });

  it("are, for a command of a playbook, a conflict as well, which a retired playbook's command answers", () => {
    expect(responsesOf('add_note')).toMatchObject({
      201: { description: 'Created' },
      409: { $ref: '#/components/responses/conflict' },
    });
    expect(responsesOf('clear_blobs')['409']).toEqual({ $ref: '#/components/responses/conflict' });
  });

  it('are, for an answer it streams, its media type with no schema, and for a body it streams, the length it requires', () => {
    expect(responsesOf('read_blob')['200']).toEqual({ description: 'Succeeded', content: { 'text/plain': {} } });
    expect(responsesOf('keep_blob')).toMatchObject({
      200: { content: { 'application/octet-stream': {} } },
      411: { $ref: '#/components/responses/length_required' },
    });
  });
});

describe('the problems operations answer', () => {
  it('are written once each under the components, each saying its reasons, with the headers they carry', () => {
    expect(components.responses['forbidden_or_origin_not_allowed']).toEqual({
      description:
        'forbidden: The credentials may not do that. origin_not_allowed: A browser sent it from an origin the server refuses.',
      content: problemContent,
    });
    expect(components.responses['unavailable']).toMatchObject({
      headers: { 'Retry-After': { schema: { type: 'string' } } },
    });
    expect(Object.keys(components.responses)).toEqual([
      'bad_request',
      'unauthenticated',
      'forbidden_or_origin_not_allowed',
      'not_found',
      'method_not_allowed',
      'conflict',
      'length_required',
      'content_too_large',
      'unsupported_media_type',
      'invalid_input',
      'internal',
      'unavailable',
    ]);
  });
});

describe('the components of the document', () => {
  it('name the org and the playbook of a path by their patterns, and the bearer key every operation takes', () => {
    expect(components.parameters).toEqual({
      org: {
        name: 'org',
        in: 'path',
        required: true,
        description: "The id of the org, which is the caller's own",
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
      },
      playbook: {
        name: 'playbook',
        in: 'path',
        required: true,
        description: 'The id of the playbook to act in',
        schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,47}$' },
      },
    });
    expect(components.securitySchemes['bearer']).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('name the identity service beside the bearer key, by the OpenID Connect metadata of the issuer it is given', () => {
    expect(components.securitySchemes['openIdConnect']).toMatchObject({
      type: 'openIdConnect',
      openIdConnectUrl: 'https://identity.example/.well-known/openid-configuration',
    });
  });

  it('tag each operation by the resource its route names, and the guides by their own, with what each tag holds', () => {
    expect(tags).toEqual([
      { name: 'notes' },
      { name: 'lines' },
      { name: 'broken' },
      { name: 'waiting' },
      { name: 'playbooks', description: 'The playbooks of the org: made, listed, read, renamed and retired' },
      { name: 'playbook-labels' },
      { name: 'blobs' },
      { name: 'rows' },
      { name: 'failing-blobs' },
      {
        name: 'guides',
        description: "The playbook's guides: what its words mean, how each kind of definition is written, and recipes",
      },
    ]);
  });
});

describe('the guides of the document', () => {
  it('are one path that takes the name of a guide the shelf holds, answers its text in Markdown, and needs no key', () => {
    const guide = operationsIn(document).find(({ operation }) => operation.operationId === 'get_guide');

    expect(guide).toMatchObject({
      path: '/guides/{guide}',
      method: 'get',
      operation: {
        summary: 'Get guide',
        tags: ['guides'],
        parameters: [
          {
            name: 'guide',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['terminology', 'notebook', 'take-a-note'] },
          },
        ],
        responses: {
          200: { content: { 'text/markdown': { schema: { type: 'string' } } } },
        },
        security: [],
      },
    });
    expect(guide?.operation.parameters?.[0]?.['description']).toMatch(
      /; one of terminology \(Terminology\), notebook \(Notebook\), take-a-note \(Take a note\)$/u,
    );
  });
});
