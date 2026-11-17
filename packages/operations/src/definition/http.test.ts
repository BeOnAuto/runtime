import { Effect, Schema } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { defineHttpOperation, InvalidInput } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { compiledErrors, probeHeader, type RejectedProbe } from '../testing/compiled-probes.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { addNote } from '../testing/notes.ts';

function definedOverHttp(kind: 'query' | 'command', lines: readonly string[]) {
  return [
    ...probeHeader,
    `export const probe = Operations.defineHttpOperation('playbook', '${kind}', {`,
    "  ...about, name: 'probe',",
    ...lines,
    '});',
  ];
}

const get = "  route: { method: 'GET', path: '/probe' },";

const post = "  route: { method: 'POST', path: '/probe' },";

const put = "  route: { method: 'PUT', path: '/probe' },";

const remove = "  route: { method: 'DELETE', path: '/probe' },";

const answeringJson = ['  inputSchema: Empty,', '  outputSchema: Empty,', '  reasons: [],'];

const answering = '  handle: () => Effect.succeed({}),';

const accepted: Readonly<Record<string, readonly string[]>> = {
  'http-query-by-get-takes-no-body.ts': definedOverHttp('query', [
    get,
    "  body: { kind: 'none' },",
    ...answeringJson,
    answering,
  ]),
  'http-query-by-post-takes-json.ts': definedOverHttp('query', [
    post,
    "  body: { kind: 'json' },",
    ...answeringJson,
    answering,
  ]),
  'http-command-by-put-takes-no-body.ts': definedOverHttp('command', [
    put,
    "  body: { kind: 'none' },",
    ...answeringJson,
    answering,
  ]),
  'http-command-by-delete-takes-no-body.ts': definedOverHttp('command', [
    remove,
    "  body: { kind: 'none' },",
    ...answeringJson,
    answering,
  ]),
};

const rejected: Readonly<Record<string, RejectedProbe>> = {
  'http-query-by-get-takes-json.ts': {
    because: 'Type \'"json"\' is not assignable to type \'"none"\'',
    source: definedOverHttp('query', [get, "  body: { kind: 'json' },", ...answeringJson, answering]),
  },
  'http-query-by-post-takes-no-body.ts': {
    because: 'Type \'"none"\' is not assignable to type \'"json"\'',
    source: definedOverHttp('query', [post, "  body: { kind: 'none' },", ...answeringJson, answering]),
  },
  'http-command-by-delete-takes-json.ts': {
    because: 'Type \'"json"\' is not assignable to type \'"none"\'',
    source: definedOverHttp('command', [remove, "  body: { kind: 'json' },", ...answeringJson, answering]),
  },
  'http-command-takes-a-body-of-no-kind-it-knows.ts': {
    because: 'Type \'"csv"\' is not assignable to type \'"json" | "none"\'',
    source: definedOverHttp('command', [post, "  body: { kind: 'csv' },", ...answeringJson, answering]),
  },
};

describe('the compiler, given operations served over HTTP alone', () => {
  let errors: readonly string[] = [];

  beforeAll(() => {
    errors = compiledErrors('http-rules', { accepted, rejected });
  });

  it('accepts every body the method of its route may take and rejects every one it may not', () => {
    expect(new Set(errors.map((error) => error.slice(0, error.indexOf('('))))).toEqual(new Set(Object.keys(rejected)));
  });

  it.each(Object.entries(rejected))('rejects %s for the rule it breaks', (file, { because }) => {
    expect(errors.filter((error) => error.startsWith(`${file}(`)).join('\n')).toContain(because);
  });
});

const toAlpha = toPlaybook('acme', 'alpha');

const Nothing = Schema.Record(Schema.String, Schema.Never);

const readNote = defineHttpOperation('playbook', 'query', {
  name: 'read_note',
  title: 'Read note',
  description: 'Reads a note.',
  route: { method: 'GET', path: '/notes/{id}' },
  body: { kind: 'none' },
  inputSchema: Schema.Struct({ id: Schema.String }),
  outputSchema: Schema.Struct({ id: Schema.String, text: Schema.String }),
  reasons: ['invalid_input'],
  handle: ({ id }) =>
    id === 'empty'
      ? Effect.fail(new InvalidInput({ detail: 'The note is empty', issues: [] }))
      : Effect.succeed({ id, text: `note ${id}` }),
});

const nameNote = defineHttpOperation('playbook', 'command', {
  name: 'name_note',
  title: 'Name note',
  description: 'Names a note.',
  route: { method: 'PUT', path: '/notes/{id}/name' },
  body: { kind: 'json' },
  repeatable: true,
  inputSchema: Schema.Struct({ id: Schema.String, name: Schema.String }),
  outputSchema: Schema.Struct({ named: Schema.String }),
  reasons: [],
  handle: ({ name }) => Effect.succeed({ named: name }),
});

describe('an operation served over HTTP alone', () => {
  it('registers the body it takes, where an operation served everywhere registers none', () => {
    expect([
      readNote.registration.servedOverHttpAlone,
      nameNote.registration.servedOverHttpAlone,
      addNote.registration.servedOverHttpAlone,
    ]).toEqual([{ kind: 'none' }, { kind: 'json' }, undefined]);
    expect(nameNote.registration).toMatchObject({
      kind: 'command',
      permissions: ['playbook:write'],
      reachesOutside: false,
      repeatable: true,
    });
    expect(readNote.registration.repeatable).toBe(false);
  });

  it('is registered with the schema of its output', () => {
    expect(nameNote.registration.output).toEqual({
      schema: {
        type: 'object',
        properties: { named: { type: 'string' } },
        required: ['named'],
        additionalProperties: false,
      },
      definitions: {},
    });
  });
});

describe('what an operation served over HTTP alone declares about itself', () => {
  it('declares what an operation served everywhere declares about itself, each false where it is left out', () => {
    const transcribeNote = defineHttpOperation('playbook', 'command', {
      name: 'transcribe_note',
      title: 'Transcribe note',
      description: 'Sends a note to a service outside to be written out, which cannot be taken back.',
      route: { method: 'POST', path: '/notes/{id}/transcription' },
      body: { kind: 'none' },
      reachesOutside: true,
      mayChangeOutside: true,
      readsOnly: true,
      irreversible: true,
      permissionsManagement: true,
      inputSchema: Schema.Struct({ id: Schema.String }),
      outputSchema: Schema.Struct({ sent: Schema.Boolean }),
      reasons: [],
      handle: () => Effect.succeed({ sent: true }),
    });
    const declared = ({
      reachesOutside,
      mayChangeOutside,
      readsOnly,
      irreversible,
      permissionsManagement,
    }: typeof nameNote.registration) => ({
      reachesOutside,
      mayChangeOutside,
      readsOnly,
      irreversible,
      permissionsManagement,
    });

    expect([declared(transcribeNote.registration), declared(nameNote.registration)]).toEqual([
      {
        reachesOutside: true,
        mayChangeOutside: true,
        readsOnly: true,
        irreversible: true,
        permissionsManagement: true,
      },
      {
        reachesOutside: false,
        mayChangeOutside: false,
        readsOnly: false,
        irreversible: false,
        permissionsManagement: false,
      },
    ]);
  });
});

describe('the definition of an operation served over HTTP alone', () => {
  it('is refused when its output is not an object that declares its fields', () => {
    expect(() =>
      defineHttpOperation('playbook', 'query', {
        name: 'read_any',
        title: 'Read any',
        description: 'Reads anything.',
        route: { method: 'GET', path: '/any' },
        body: { kind: 'none' },
        inputSchema: Nothing,
        outputSchema: Schema.Struct({}),
        reasons: [],
        handle: () => Effect.succeed({}),
      }),
    ).toThrow('The output of read_any must be an object that declares its fields');
  });
});

describe('the call of an operation served over HTTP alone', () => {
  it('hands its handler its input and answers its output as JSON, or its rejection', async () => {
    const { dispatcher, run } = harness();

    const outcomes = await Promise.all([
      run(dispatcher.dispatchToPlaybook(readNote.registration, toAlpha(acmeAdmin, { id: 'n1' }))),
      run(dispatcher.dispatchToPlaybook(readNote.registration, toAlpha(acmeAdmin, { id: 'empty' }))),
      run(dispatcher.dispatchToPlaybook(nameNote.registration, toAlpha(acmeAdmin, { id: 'n1', name: 'first' }))),
    ]);

    expect(outcomes).toEqual([
      { status: 'succeeded', output: { id: 'n1', text: 'note n1' } },
      { status: 'rejected', reason: 'invalid_input', detail: 'The note is empty', issues: [] },
      { status: 'succeeded', output: { named: 'first' } },
    ]);
  });
});
