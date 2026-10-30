import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { InvalidInput, defineHttpOperation } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { addNote } from '../testing/notes.ts';

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
    });
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
