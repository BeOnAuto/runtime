import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { trackerAuthorizationServer, trackerDiscovery } from '../testing/discovery-documents.ts';
import { discoveryDocumentOf } from './discovery-document.ts';
import { discoveryParametersChanged, type ParameterChanges } from './discovery-parameters.ts';
import { translatedDiscoveryOf } from './translate-discovery.ts';

const listId = 'tracker.projects.issues.list';

const OperationsSchema = Schema.Struct({
  paths: Schema.Record(
    Schema.String,
    Schema.Record(
      Schema.String,
      Schema.Struct({
        operationId: Schema.String,
        parameters: Schema.Array(Schema.Struct({ name: Schema.String, required: Schema.optionalKey(Schema.Boolean) })),
      }),
    ),
  ),
  components: Schema.Struct({ schemas: Schema.Record(Schema.String, Schema.Unknown) }),
});

const decodeOperations = Schema.decodeUnknownSync(OperationsSchema);

const labelled = {
  ...trackerDiscovery,
  schemas: {
    ...trackerDiscovery.schemas,
    Label: { ...trackerDiscovery.schemas.Label, required: ['title'], properties: { title: {}, color: {} } },
  },
};

function translated(changes: ParameterChanges, discovery: unknown = labelled) {
  const { document } = translatedDiscoveryOf(discovery, trackerAuthorizationServer, {
    methods: [listId, 'tracker.about.get', 'tracker.projects.issues.mutate'],
    ...changes,
  });
  return decodeOperations(document);
}

function parametersOf(changes: ParameterChanges, path: string) {
  return Object.values(translated(changes).paths[path] ?? {}).flatMap(({ parameters }) => parameters);
}

const because = 'The description of the method says a call must send it';

function leftOut(method: string, parameters: readonly string[]): () => unknown {
  return () => translated({ left_out_parameters: [{ method, parameters, because: 'A call never sends it' }] });
}

const bare = discoveryDocumentOf({
  name: 'bare',
  version: 'v1',
  revision: '20261029',
  rootUrl: 'https://bare.example.com/',
  servicePath: '',
  methods: { ping: { id: 'bare.ping', path: 'v1/ping', httpMethod: 'GET', scopes: ['https://bare.example.com/auth'] } },
});

describe('the parameters a manifest requires', () => {
  it('are required of a call of the method, nested in its resources or at the root of the document', () => {
    const changes = {
      required: [
        { method: listId, parameters: ['pageSize'], because },
        { method: 'tracker.about.get', parameters: ['fields'], because },
      ],
    };

    expect(parametersOf(changes, '/v1/projects/{projectsId}/issues')).toContainEqual(
      expect.objectContaining({ name: 'pageSize', required: true }),
    );
    expect(parametersOf(changes, '/v1/about/{version}')).toContainEqual(
      expect.objectContaining({ name: 'fields', required: true }),
    );
  });

  it('are required of a request where a schema must hold them, beside those it requires already', () => {
    const { components } = translated({ required: [{ schema: 'Label', properties: ['color'], because }] });

    expect(components.schemas['Label']).toMatchObject({ required: ['title', 'color'] });
    expect(
      translated({ required: [{ schema: 'Issue', properties: ['state'], because }] }).components.schemas,
    ).toHaveProperty(['Issue', 'required'], ['state']);
  });

  it('are refused where the method, the parameter, the schema or the property is not in the Discovery document', () => {
    expect(() =>
      translated({ required: [{ method: 'tracker.issues.close', parameters: ['state'], because }] }),
    ).toThrow('The Discovery document has no method tracker.issues.close, which a requirement names');
    expect(() => translated({ required: [{ method: listId, parameters: ['owner', 'pageSize'], because }] })).toThrow(
      `The method ${listId} of the Discovery document has no parameter owner, which a requirement names`,
    );
    expect(() => translated({ required: [{ schema: 'Comment', properties: ['body'], because }] })).toThrow(
      'The Discovery document has no schema Comment, which a requirement names',
    );
    expect(() => translated({ required: [{ schema: 'Unused', properties: ['body'], because }] })).toThrow(
      'The schema Unused of the Discovery document has no property body, which a requirement names',
    );
  });
});

describe('the parameters a manifest leaves out', () => {
  it('are left out of the method, its other parameters kept', () => {
    const names = parametersOf(
      { left_out_parameters: [{ method: listId, parameters: ['pageSize'], because: 'A call never sends it' }] },
      '/v1/projects/{projectsId}/issues',
    ).map(({ name }) => name);

    expect(names).toEqual(['projectsId', 'labels', 'query', 'fields']);
  });

  it('are refused where the method or the parameter is not in the Discovery document', () => {
    expect(leftOut('tracker.issues.close', ['state'])).toThrow(
      'The Discovery document has no method tracker.issues.close, which a parameter left out names',
    );
    expect(leftOut(listId, ['owner'])).toThrow(
      `The method ${listId} of the Discovery document has no parameter owner, which a parameter left out names`,
    );
  });
});

const decodeDescribedPaths = Schema.decodeUnknownSync(
  Schema.Record(
    Schema.String,
    Schema.Record(
      Schema.String,
      Schema.Struct({
        description: Schema.String,
        parameters: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    ),
  ),
);

function keptGlobal(method: string, parameter: string, values: readonly string[]): () => unknown {
  return () => translated({ global_parameters: [{ method, parameter, values, says: 'It answers media.' }] });
}

describe('the global parameters a manifest keeps', () => {
  it('are parameters of the method taking the values the manifest names alone, its words ending the description of the method', () => {
    const { document } = translatedDiscoveryOf(labelled, trackerAuthorizationServer, {
      methods: [listId, 'tracker.about.get'],
      global_parameters: [
        {
          method: listId,
          parameter: 'alt',
          values: ['media'],
          says: 'With alt=media it answers the issues as a file.',
        },
        { method: 'tracker.about.get', parameter: 'alt', values: ['media'], says: 'With alt=media it answers a file.' },
      ],
    });
    const documented = decodeDescribedPaths(document['paths']);

    const takesMediaAlone: unknown = expect.arrayContaining([
      { name: 'alt', in: 'query', schema: { enum: ['media'], type: 'string' } },
    ]);

    expect(documented['/v1/projects/{projectsId}/issues']?.['get']).toMatchObject({
      description: 'Lists issues. With alt=media it answers the issues as a file.',
      parameters: takesMediaAlone,
    });
    expect(documented['/v1/about/{version}']?.['get']?.description).toBe('With alt=media it answers a file.');
  });

  it('are refused where the method, the global parameter or one of its values is not in the Discovery document', () => {
    expect(keptGlobal('tracker.issues.close', 'alt', ['media'])).toThrow(
      'The Discovery document has no method tracker.issues.close, which a global parameter kept names',
    );
    expect(keptGlobal(listId, 'callback', ['media'])).toThrow(
      'The Discovery document has no global parameter callback, which a global parameter kept names',
    );
    expect(keptGlobal(listId, 'alt', ['proto', 'media'])).toThrow(
      'The global parameter alt of the Discovery document lists no value proto, which a global parameter kept names',
    );
    expect(keptGlobal(listId, 'key', ['media'])).toThrow(
      'The global parameter key of the Discovery document lists no value media, which a global parameter kept names',
    );
  });
});

describe('the parameters a manifest changes of a Discovery document that holds little', () => {
  it('are refused for a method without parameters and a document without schemas', () => {
    expect(() =>
      discoveryParametersChanged(bare, { required: [{ method: 'bare.ping', parameters: ['q'], because }] }),
    ).toThrow('The method bare.ping of the Discovery document has no parameter q, which a requirement names');
    expect(() =>
      discoveryParametersChanged(bare, { required: [{ schema: 'Ping', properties: ['at'], because }] }),
    ).toThrow('The Discovery document has no schema Ping, which a requirement names');
    expect(() =>
      discoveryParametersChanged(bare, {
        global_parameters: [{ method: 'bare.ping', parameter: 'alt', values: ['media'], says: 'It answers media.' }],
      }),
    ).toThrow('The Discovery document has no global parameter alt, which a global parameter kept names');
  });
});
