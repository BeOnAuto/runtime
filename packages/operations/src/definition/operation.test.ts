import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlaybookReader, PlaybookWriter, InvalidInput, NotFound, defineCommand, defineQuery } from '../index.ts';
import {
  playbookBoundAppendedFactsReader,
  playbookBoundProjectionReader,
  playbookBoundRecordedReader,
  playbookBoundRunOutcomesReader,
} from '../ledger/bound-ports.ts';
import { publishDraft } from '../testing/drafts.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { misreport, overshare } from '../testing/misbehaving.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { labelPlaybook } from '../testing/playbook-labels.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const about = {
  title: 'Probe',
  description: 'Probes the definer.',
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.succeed({}),
};

const measure = defineQuery('playbook', {
  name: 'measure',
  title: 'Measure',
  description: 'Computes the area of a circle or a square.',
  route: { method: 'GET', path: '/measure' },
  inputSchema: Schema.Union([
    Schema.Struct({ shape: Schema.Literal('circle'), radius: Schema.Finite }),
    Schema.Struct({ shape: Schema.Literal('square'), side: Schema.Finite }),
  ]),
  outputSchema: Schema.Struct({ area: Schema.Finite }),
  reasons: [],
  handle: (input) => Effect.succeed({ area: input.shape === 'circle' ? Math.PI * input.radius ** 2 : input.side ** 2 }),
});

function schemaDefectOf<A, E, R>(call: Effect.Effect<A, E, R>): Effect.Effect<boolean, E, R> {
  return call.pipe(
    Effect.as(false),
    Effect.catchDefect((defect) => Effect.succeed(Schema.isSchemaError(defect))),
  );
}

const noteJsonSchema = {
  type: 'object',
  properties: { name: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' }, text: { type: 'string' } },
  required: ['name', 'text'],
  additionalProperties: false,
};

describe('a registration', () => {
  it('describes a command with its route, success status, reasons and schemas', () => {
    expect(addNote.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      name: 'add_note',
      title: 'Add note',
      description: 'Adds a note to the playbook.',
      route: { method: 'POST', path: '/notes' },
      pathParameters: [],
      successStatus: 201,
      reasons: ['conflict'],
    });
    expect(addNote.registration.input).toEqual({ schema: noteJsonSchema, definitions: {} });
  });

  it('answers with 200 unless the definition says otherwise, and names its path parameters', () => {
    expect(getNote.registration).toMatchObject({ successStatus: 200, pathParameters: ['name'] });
    expect(labelPlaybook.registration).toMatchObject({
      scope: 'org',
      successStatus: 200,
      pathParameters: ['playbook'],
    });
  });

  it('carries its output as a JSON Schema document beside its input, with the definitions it names', () => {
    expect(addNote.registration.output).toEqual({
      schema: {
        type: 'object',
        properties: { added: { $ref: '#/$defs/Note' }, version: { type: 'integer' } },
        required: ['added', 'version'],
        additionalProperties: false,
      },
      definitions: { Note: noteJsonSchema },
    });
    expect(measure.registration.output.schema).toEqual({
      type: 'object',
      properties: { area: { type: 'number' } },
      required: ['area'],
      additionalProperties: false,
    });
  });
});

describe('the input of a registration', () => {
  it('is exported, for a union, as one object schema with a branch per member', () => {
    expect(measure.registration.input.schema).toEqual({
      type: 'object',
      anyOf: [
        {
          type: 'object',
          properties: { shape: { type: 'string', enum: ['circle'] }, radius: { type: 'number' } },
          required: ['shape', 'radius'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { shape: { type: 'string', enum: ['square'] }, side: { type: 'number' } },
          required: ['shape', 'side'],
          additionalProperties: false,
        },
      ],
    });
  });
});

describe('a query routed by POST', () => {
  it('stays a query, permitted by the read permission of its scope', () => {
    const posted = defineQuery('playbook', { ...about, name: 'posted', route: { method: 'POST', path: '/posted' } });

    expect(posted.registration).toMatchObject({
      kind: 'query',
      route: { method: 'POST', path: '/posted' },
      permissions: ['playbook:read'],
    });
  });
});

describe('the reach of a registration', () => {
  it('says it reaches systems outside the server only when its definition says so', () => {
    const asking = defineQuery('org', {
      ...about,
      name: 'ask',
      route: { method: 'GET', path: '/ask' },
      reachesOutside: true,
    });

    expect([addNote.registration.reachesOutside, asking.registration.reachesOutside]).toEqual([false, true]);
  });

  it('says it may change something outside the server only when its definition says so', () => {
    const acting = defineCommand('org', {
      ...about,
      name: 'act',
      route: { method: 'POST', path: '/act' },
      reachesOutside: true,
      mayChangeOutside: true,
    });

    expect([addNote.registration.mayChangeOutside, acting.registration.mayChangeOutside]).toEqual([false, true]);
  });
});

describe('what a registration says of a repeated call', () => {
  it('says it cannot be undone, and that a repeat records nothing, only when its definition says so', () => {
    const retiring = defineCommand('org', {
      ...about,
      name: 'retire',
      route: { method: 'POST', path: '/retire' },
      irreversible: true,
      repeatable: true,
    });

    expect(
      [addNote.registration, retiring.registration].map(({ irreversible, repeatable }) => ({
        irreversible,
        repeatable,
      })),
    ).toEqual([
      { irreversible: false, repeatable: false },
      { irreversible: true, repeatable: true },
    ]);
  });
});

describe('a definition', () => {
  it.each(['Probe', 'probe-name', '', '1probe', `p${'r'.repeat(64)}`])('may not be named %j', (name) => {
    expect(() => defineQuery('org', { ...about, name, route: { method: 'GET', path: '/probe' } })).toThrow(
      `The operation name ${name} is malformed`,
    );
  });

  const malformedPaths: ReadonlyArray<`/${string}`> = [
    '/',
    '/Probe',
    '/a//b',
    '/a/',
    '/{}',
    '/{1a}',
    '/a b',
    '/{a}/{a}',
  ];

  it.each(malformedPaths)('may not have the route path %j', (path) => {
    expect(() => defineQuery('org', { ...about, name: 'probe', route: { method: 'GET', path } })).toThrow(
      `The route path ${path} is malformed`,
    );
  });
});

function readerOf({ service }: MemoryLedger): PlaybookReader['Service'] {
  const alpha = { org: 'acme', playbook: 'alpha' };
  return {
    ...service,
    ...playbookBoundRecordedReader(service, alpha),
    ...playbookBoundAppendedFactsReader(service, alpha),
    ...playbookBoundRunOutcomesReader(service, alpha),
    ...playbookBoundProjectionReader(service, alpha),
    readContent: (sha256) => service.content.get(alpha, sha256),
  };
}

describe('the typed call', () => {
  const ledger = memoryLedger();
  const withNotes = <A, E>(call: Effect.Effect<A, E, PlaybookReader | PlaybookWriter>) =>
    call.pipe(
      Effect.provideService(PlaybookReader, readerOf(ledger)),
      Effect.provideService(PlaybookWriter, ledger.service),
    );

  it('runs the handler with typed input and output in the services it is given', async () => {
    const read = await Effect.runPromise(
      withNotes(
        Effect.gen(function* () {
          yield* addNote.call({ name: 'anvil', text: 'heavy' });
          return yield* getNote.call({ name: 'anvil' });
        }),
      ),
    );

    expect(read).toEqual({ name: 'anvil', text: 'heavy' });
    expect(ledger.streamNames()).toEqual(['notes']);
  });

  it('fails with the rejection the handler declares', async () => {
    const rejection = await Effect.runPromise(withNotes(Effect.flip(getNote.call({ name: 'missing' }))));

    expect(rejection).toEqual(new NotFound({ detail: 'There is no note missing' }));
  });

  it('decodes a union input by its members', async () => {
    expect(await Effect.runPromise(measure.call({ shape: 'square', side: 3 }))).toEqual({ area: 9 });
    expect(await Effect.runPromise(measure.call({ shape: 'circle', radius: 1 }))).toEqual({ area: Math.PI });
  });

  it('treats input that breaks the input schema as a defect of the calling code', async () => {
    expect(await Effect.runPromise(withNotes(schemaDefectOf(getNote.call({ name: 'Not A Name' }))))).toBe(true);
  });

  it('treats output that breaks the output schema as a defect', async () => {
    expect(await Effect.runPromise(schemaDefectOf(misreport.call({})))).toBe(true);
  });

  it('treats a field the schemas do not declare as a defect, in the input and in the output', async () => {
    const anvilWithExtra = { name: 'anvil', text: 'heavy', extra: 1 };

    expect(await Effect.runPromise(withNotes(schemaDefectOf(addNote.call(anvilWithExtra))))).toBe(true);
    expect(await Effect.runPromise(schemaDefectOf(overshare.call({})))).toBe(true);
  });
});

describe('invalid input from a handler', () => {
  it('is a reason a definition declares like any other', () => {
    expect(publishDraft.registration).toMatchObject({ kind: 'command', reasons: ['invalid_input'] });
  });

  it('reaches the typed call as the handler gives it', async () => {
    const rejection = await Effect.runPromise(Effect.flip(publishDraft.call({ lines: ['wrong'] })));

    expect(rejection).toEqual(
      new InvalidInput({
        detail: 'The draft has lines to fix',
        issues: [{ detail: 'Line 1 must start with a capital letter', pointer: '/lines/0' }],
      }),
    );
  });
});
