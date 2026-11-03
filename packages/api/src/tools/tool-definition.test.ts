import { defineCommand, defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolDefinitionOf } from './tool-definition.ts';

const Nothing = Schema.Record(Schema.String, Schema.Never);

function askingWith(reach: { readonly reachesOutside?: boolean }) {
  return defineQuery('org', {
    name: 'ask_weather',
    title: 'Ask weather',
    description: 'Asks a weather service. Use it for the weather. It answers nothing.',
    route: { method: 'GET', path: '/weather' },
    inputSchema: Nothing,
    outputSchema: Nothing,
    reasons: [],
    handle: () => Effect.succeed({}),
    ...reach,
  });
}

describe('the open-world hint of a tool', () => {
  it('is true when its operation says it reaches systems outside the server, and false otherwise', () => {
    const reaching = toolDefinitionOf(askingWith({ reachesOutside: true }).registration);
    const local = toolDefinitionOf(askingWith({}).registration);

    expect([reaching.annotations.openWorldHint, local.annotations.openWorldHint]).toEqual([true, false]);
  });
});

describe('the read-only hint of a tool', () => {
  it('follows the kind of its operation, so a query routed by POST only reads', () => {
    const posted = defineQuery('org', {
      name: 'ask_forecast',
      title: 'Ask forecast',
      description: 'Asks for a forecast of the places given. Use it for many places at once. It answers nothing.',
      route: { method: 'POST', path: '/forecast' },
      inputSchema: Schema.Struct({ places: Schema.Array(Schema.String) }),
      outputSchema: Nothing,
      reasons: [],
      handle: () => Effect.succeed({}),
    });

    expect(toolDefinitionOf(posted.registration).annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
  });
});

describe('the title annotation of a tool', () => {
  it('is the title of its operation, so a directory shows a readable name', () => {
    expect(toolDefinitionOf(askingWith({}).registration).annotations.title).toBe('Ask weather');
  });
});

describe('an argument that takes any JSON value', () => {
  it('is advertised with every JSON type, so a client that needs a type for each argument accepts it', () => {
    const answering = defineQuery('org', {
      name: 'ask_answer',
      title: 'Ask answer',
      description: 'Asks with any answer. Use it to send an answer. It answers nothing.',
      route: { method: 'POST', path: '/answer' },
      inputSchema: Schema.Struct({ answer: Schema.Json.annotate({ description: 'Any answer' }) }),
      outputSchema: Nothing,
      reasons: [],
      handle: () => Effect.succeed({}),
    });
    const schema = toolDefinitionOf(answering.registration).inputSchema['~standard'].jsonSchema.input({
      target: 'draft-2020-12',
    });

    expect(schema['properties']).toEqual({
      answer: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'], description: 'Any answer' },
    });
  });
});

function fetchingWith(readsOnly: boolean) {
  return defineCommand('org', {
    name: 'fetch_weather',
    title: 'Fetch weather',
    description: 'Fetches the weather and keeps it. Use it for the weather. It answers nothing.',
    route: { method: 'POST', path: '/weather' },
    inputSchema: Nothing,
    outputSchema: Nothing,
    reasons: [],
    handle: () => Effect.succeed({}),
    reachesOutside: true,
    readsOnly,
  });
}

describe('the read-only hint of a tool', () => {
  it('is true for a query and for a command that only reads outside the server, and false otherwise', () => {
    const asking = toolDefinitionOf(askingWith({}).registration);
    const fetching = toolDefinitionOf(fetchingWith(true).registration);
    const keeping = toolDefinitionOf(fetchingWith(false).registration);

    expect([asking, fetching, keeping].map(({ annotations }) => annotations.readOnlyHint)).toEqual([true, true, false]);
  });
});

describe('the destructive hint of a tool', () => {
  it('is true for every tool that does not only read, whatever it changes, and false for one that only reads', () => {
    const asking = toolDefinitionOf(askingWith({ reachesOutside: true }).registration);
    const fetching = toolDefinitionOf(fetchingWith(true).registration);
    const keeping = toolDefinitionOf(fetchingWith(false).registration);

    expect([asking, fetching, keeping].map(({ annotations }) => annotations.destructiveHint)).toEqual([
      false,
      false,
      true,
    ]);
  });
});

function eventTaking(
  idDescription: string,
  inputSchema = Schema.Struct({ id: Schema.String.annotate({ description: idDescription }) }),
) {
  return defineQuery('playbook', {
    name: 'nest_definition',
    title: 'Nest',
    description: 'Nests. Use it to nest. It answers.',
    route: { method: 'GET', path: '/nest' },
    inputSchema: Schema.Struct({
      event: inputSchema,
      kind: Schema.Literals(['first', 'second']).annotate({ description: 'The kind' }),
      note: Schema.optionalKey(Schema.String),
    }),
    outputSchema: Schema.Struct({ nested: Schema.Boolean }),
    reasons: [],
    handle: () => Effect.succeed({ nested: true }),
    plainLanguage: { task: 'nest', attempt: () => 'nest', outcome: () => 'Nested.' },
  });
}

describe('the description of an argument at any depth of the input', () => {
  it('is served at 300 characters, and refused at 301, naming the path to the argument', () => {
    expect(() => toolDefinitionOf(eventTaking('i'.repeat(300)).registration)).not.toThrow();
    expect(() => toolDefinitionOf(eventTaking('i'.repeat(301)).registration)).toThrow(
      'The description of event.id of nest_definition: 301 characters, more than the 300 allowed',
    );
  });

  it('is checked in a definition the input refers to, by the name of the definition', () => {
    const Event = Schema.Struct({ id: Schema.String.annotate({ description: 'i'.repeat(301) }) }).annotate({
      identifier: 'Event',
    });

    expect(() => toolDefinitionOf(eventTaking('', Event).registration)).toThrow(
      'The description of Event.id of nest_definition: 301 characters, more than the 300 allowed',
    );
  });
});
