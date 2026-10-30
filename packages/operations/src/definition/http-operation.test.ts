import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  InvalidInput,
  contentOfText,
  defineHttpOperation,
  textOfContent,
  type Outcome,
  type StreamedContent,
  type Succeeded,
} from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { addNote } from '../testing/notes.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const Nothing = Schema.Record(Schema.String, Schema.Never);

const octets = 'application/octet-stream';

const keepModel = defineHttpOperation('playbook', 'command', {
  name: 'keep_model',
  title: 'Keep model',
  description: 'Keeps the bytes of a model.',
  route: { method: 'POST', path: '/models/{id}' },
  body: { kind: 'octet-stream', mostBytes: 1024 },
  inputSchema: Schema.Struct({ id: Schema.String }),
  answer: {
    kind: 'json',
    outputSchema: Schema.Struct({ id: Schema.String, bytes: Schema.Number, media_type: Schema.String }),
  },
  reasons: ['invalid_input'],
  handle: ({ id }, body) =>
    body.bytes === 0
      ? Effect.fail(new InvalidInput({ detail: 'The model is empty', issues: [] }))
      : Effect.succeed({ id, bytes: body.bytes, media_type: body.mediaType }),
});

const readModel = defineHttpOperation('playbook', 'query', {
  name: 'read_model',
  title: 'Read model',
  description: 'Reads the bytes of a model.',
  route: { method: 'GET', path: '/models/{id}' },
  body: { kind: 'none' },
  inputSchema: Schema.Struct({ id: Schema.String }),
  answer: { kind: 'stream', mediaType: 'text/plain' },
  reasons: [],
  handle: ({ id }) => Effect.succeed(contentOfText(`model ${id}`, 'application/octet-stream')),
});

const nameModel = defineHttpOperation('playbook', 'command', {
  name: 'name_model',
  title: 'Name model',
  description: 'Names a model.',
  route: { method: 'PUT', path: '/models/{id}/name' },
  body: { kind: 'json' },
  inputSchema: Schema.Struct({ id: Schema.String, name: Schema.String }),
  answer: { kind: 'json', outputSchema: Schema.Struct({ named: Schema.String }) },
  reasons: [],
  handle: ({ name }) => Effect.succeed({ named: name }),
});

function withMostBytes(mostBytes: number) {
  return () =>
    defineHttpOperation('playbook', 'command', {
      name: 'keep_any',
      title: 'Keep any',
      description: 'Keeps anything.',
      route: { method: 'POST', path: '/any' },
      body: { kind: 'csv', mostBytes },
      inputSchema: Nothing,
      answer: { kind: 'json', outputSchema: Nothing },
      reasons: [],
      handle: () => Effect.succeed({}),
    });
}

function streamedOf(outcome: Outcome<Succeeded>): StreamedContent {
  if (outcome.status !== 'succeeded' || !('streamed' in outcome)) {
    throw new Error('The call answered no stream');
  }
  return outcome.streamed;
}

describe('an operation served over HTTP alone', () => {
  it('registers the body it takes, where an operation served everywhere registers none', () => {
    expect([
      keepModel.registration.servedOverHttpAlone,
      readModel.registration.servedOverHttpAlone,
      nameModel.registration.servedOverHttpAlone,
      addNote.registration.servedOverHttpAlone,
    ]).toEqual([{ kind: 'octet-stream', mostBytes: 1024 }, { kind: 'none' }, { kind: 'json' }, undefined]);
    expect(keepModel.registration).toMatchObject({
      kind: 'command',
      permissions: ['playbook:write'],
      reachesOutside: false,
    });
  });
});

describe('the answer of an operation served over HTTP alone', () => {
  it("is registered with its JSON answer's output schema, or its streamed answer's media type and no schema", () => {
    expect([nameModel.registration.answer, readModel.registration.answer]).toEqual([
      {
        kind: 'json',
        output: {
          schema: {
            type: 'object',
            properties: { named: { type: 'string' } },
            required: ['named'],
            additionalProperties: false,
          },
          definitions: {},
        },
      },
      { kind: 'stream', mediaType: 'text/plain' },
    ]);
  });
});

describe('the definition of an operation served over HTTP alone', () => {
  it('is refused when its streamed body has no whole number of most bytes above 0', () => {
    expect(withMostBytes(0)).toThrow('The most bytes of the body of keep_any must be a whole number above 0');
    expect(withMostBytes(1.5)).toThrow('The most bytes of the body of keep_any must be a whole number above 0');
    expect(withMostBytes(1)).not.toThrow();
  });

  it('is refused when its JSON answer is not an object that declares its fields', () => {
    expect(() =>
      defineHttpOperation('playbook', 'query', {
        name: 'read_any',
        title: 'Read any',
        description: 'Reads anything.',
        route: { method: 'GET', path: '/any' },
        body: { kind: 'none' },
        inputSchema: Nothing,
        answer: { kind: 'json', outputSchema: Schema.Struct({}) },
        reasons: [],
        handle: () => Effect.succeed({}),
      }),
    ).toThrow('The output of read_any must be an object that declares its fields');
  });
});

describe('the call of an operation served over HTTP alone', () => {
  it('hands its handler the body as a stream with its size and media type, and answers its output as JSON', async () => {
    const { dispatcher, run } = harness();

    const outcomes = await Promise.all([
      run(
        dispatcher.dispatchToPlaybook(keepModel.registration, {
          ...toAlpha(acmeAdmin, { id: 'm1' }),
          body: contentOfText('weights', octets),
        }),
      ),
      run(
        dispatcher.dispatchToPlaybook(keepModel.registration, {
          ...toAlpha(acmeAdmin, { id: 'm2' }),
          body: contentOfText('', octets),
        }),
      ),
      run(dispatcher.dispatchToPlaybook(nameModel.registration, toAlpha(acmeAdmin, { id: 'm1', name: 'first' }))),
    ]);

    expect(outcomes).toEqual([
      { status: 'succeeded', output: { id: 'm1', bytes: 7, media_type: octets } },
      { status: 'rejected', reason: 'invalid_input', detail: 'The model is empty', issues: [] },
      { status: 'succeeded', output: { named: 'first' } },
    ]);
  });

  it('answers the stream its handler gives with the media type its answer declares, and no output', async () => {
    const { dispatcher, run } = harness();

    const outcome = await run(dispatcher.dispatchToPlaybook(readModel.registration, toAlpha(acmeAdmin, { id: 'm1' })));

    expect(outcome).toMatchObject({ status: 'succeeded', streamed: { bytes: 8, mediaType: 'text/plain' } });
    expect(Object.keys(outcome)).toEqual(['status', 'streamed']);
    expect(await Effect.runPromise(textOfContent(streamedOf(outcome)))).toBe('model m1');
  });

  it('fails when an operation that takes its body as a stream is given none', async () => {
    const { dispatcher, run, reported } = harness();

    const outcome = await run(dispatcher.dispatchToPlaybook(keepModel.registration, toAlpha(acmeAdmin, { id: 'm1' })));

    expect(outcome.status).toBe('failed');
    expect(reported().map(({ original }) => String(original))).toEqual([
      'Error: The operation keep_model takes its body as a stream and was given none',
    ]);
  });
});
