import { readFileSync } from 'node:fs';

import {
  oldWordsIn,
  openApiErrorsIn,
  operationsIn,
  unresolvedSchemasIn,
  withMcpSession,
  type DocumentedOperation,
} from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let text: string;
let document: unknown;

const keptDocument = new URL('../../../../docs/assets/openapi.json', import.meta.url);

beforeAll(async () => {
  server = await servingReasoning([]);
  text = await (await fetch(`${server.origin}/v1/openapi.json`)).text();
  document = JSON.parse(text);
});

afterAll(async () => {
  await server.stop();
});

const TagsSchema = Schema.Struct({ tags: Schema.Array(Schema.Struct({ name: Schema.String })) });

const ResourcesSchema = Schema.Struct({ resources: Schema.Array(Schema.Struct({ name: Schema.String })) });

const ContentsSchema = Schema.Struct({ contents: Schema.Array(Schema.Struct({ text: Schema.String })) });

function resourcesOverMcp(): Promise<readonly (readonly [string, string])[]> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) => {
    const { resources } = Schema.decodeUnknownSync(ResourcesSchema)(await session.listResources());
    return Promise.all(
      resources.map(async ({ name }) => {
        const { contents } = Schema.decodeUnknownSync(ContentsSchema)(await session.readResource(`guide://${name}`));
        return [name, contents.map((content) => content.text).join('')] as const;
      }),
    );
  });
}

describe('the OpenAPI document of the server', () => {
  it('is one the published schema of OpenAPI 3.1 accepts, every schema in it resolving its references by its $id', () => {
    expect(openApiErrorsIn(document)).toEqual([]);
    expect(unresolvedSchemasIn(document)).toEqual([]);
  });

  it('describes the 50 operations of the catalog and the guides, under the tags of their resources', () => {
    expect(operationsIn(document)).toHaveLength(50);
    expect(Schema.decodeUnknownSync(TagsSchema)(document).tags.map(({ name }) => name)).toEqual([
      'playbooks',
      'models',
      'tool-servers',
      'connections',
      'providers',
      'license',
      'definitions',
      'runs',
      'analytics',
      'events',
      'interactions',
      'prediction',
      'guides',
    ]);
  });

  it('is the kept document, docs/assets/openapi.json, at the version of the release; pnpm docs:openapi writes it again', () => {
    expect(document).toEqual(JSON.parse(readFileSync(keptDocument, 'utf8')));
    expect(document).toMatchObject({ info: { version: release.version } });
  });

  it('names the OpenID Connect metadata of the Auto identity service when IDENTITY_ISSUER is not set', () => {
    expect(document).toMatchObject({
      components: {
        securitySchemes: {
          openIdConnect: {
            type: 'openIdConnect',
            openIdConnectUrl: 'https://clerk.on.auto/.well-known/openid-configuration',
          },
        },
      },
    });
  });

  it('says none of the old words the vocabulary of the repository refuses', () => {
    expect(oldWordsIn(text)).toEqual([]);
  });
});

const AnsweredFieldsSchema = Schema.Struct({
  content: Schema.Struct({
    'application/json': Schema.Struct({
      schema: Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Json) }),
    }),
  }),
});

function answeredField(operationId: string, status: string, field: string): unknown {
  const described = operationsIn(document).find(({ operation }) => operation.operationId === operationId);
  const { content } = Schema.decodeUnknownSync(AnsweredFieldsSchema)(described?.operation.responses[status]);
  return content['application/json'].schema.properties[field];
}

function theCallerWho(did: string) {
  return {
    type: 'object',
    description: `The caller who ${did}, by id and name`,
    properties: { id: { type: 'string', description: 'The id of the caller' }, name: { type: 'string' } },
    required: ['id', 'name'],
  };
}

describe('who did something, in the document', () => {
  it('is the caller who did it, by id and name, on a playbook, a definition, a connection, a run and an answer', () => {
    expect([
      answeredField('create_playbook', '201', 'created_by'),
      answeredField('get_definition', '200', 'created_by'),
      answeredField('add_connection', '201', 'added_by'),
      answeredField('get_run', '200', 'started_by'),
      answeredField('answer_interaction', '200', 'answered_by'),
    ]).toMatchObject([
      theCallerWho('created the playbook'),
      theCallerWho('created the definition'),
      theCallerWho('added it'),
      theCallerWho('started the run'),
      theCallerWho('answered it'),
    ]);
  });

  it('is the caller who connected a connection, by id and name, or null while nobody has', () => {
    const { description, ...caller } = theCallerWho('connected it, approving it or giving its credential');

    expect(answeredField('get_connection', '200', 'connected_by')).toMatchObject({
      anyOf: [caller, { type: 'null' }],
      description,
    });
  });
});

function shapeOf({ path, method, operation }: DocumentedOperation): readonly string[] {
  return [
    operation.operationId,
    `${method.toUpperCase()} ${path}`,
    operation.requestBody === undefined ? 'no body' : 'a JSON body',
    '409' in operation.responses ? 'refused on a retired playbook' : 'served on a retired playbook',
  ];
}

describe('the five operations over the tool servers in the document', () => {
  it('carry validate and dry_run by POST with a body, as queries a retired playbook still serves, and execute as a command', () => {
    const toolServers = operationsIn(document).filter(({ path }) => path.includes('/tool-servers/'));

    expect(toolServers.map((described) => shapeOf(described))).toEqual([
      ['search_in_org', 'GET /orgs/{org}/tool-servers/search', 'no body', 'served on a retired playbook'],
      ['search', 'GET /orgs/{org}/playbooks/{playbook}/tool-servers/search', 'no body', 'served on a retired playbook'],
      [
        'introspect',
        'GET /orgs/{org}/playbooks/{playbook}/tool-servers/{server}/tools/{tool}',
        'no body',
        'served on a retired playbook',
      ],
      [
        'validate',
        'POST /orgs/{org}/playbooks/{playbook}/tool-servers/{server}/tools/{tool}/validate',
        'a JSON body',
        'served on a retired playbook',
      ],
      [
        'dry_run',
        'POST /orgs/{org}/playbooks/{playbook}/tool-servers/{server}/tools/{tool}/dry-run',
        'a JSON body',
        'served on a retired playbook',
      ],
      [
        'execute',
        'POST /orgs/{org}/playbooks/{playbook}/tool-servers/{server}/tools/{tool}/execute',
        'a JSON body',
        'refused on a retired playbook',
      ],
    ]);
  });
});

describe('the guides over HTTP', () => {
  it('are each guide the MCP resources hold, byte for byte, without a key', async () => {
    const resources = await resourcesOverMcp();
    const overHttp = await Promise.all(
      resources.map(
        async ([name]) => [name, await (await fetch(`${server.origin}/v1/guides/${name}`)).text()] as const,
      ),
    );

    expect(resources).toHaveLength(12);
    expect(overHttp).toEqual(resources);
  });
});
