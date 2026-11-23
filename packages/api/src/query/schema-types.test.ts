import {
  GraphQLObjectType,
  GraphQLSchema,
  graphql,
  printSchema,
  type GraphQLFieldConfigMap,
  type GraphQLOutputType,
} from 'graphql';
import { describe, expect, it } from 'vitest';

import { typesOfJsonSchema, type JsonNode, type JsonDefinitions } from './schema-types.ts';

function schemaOf(fields: GraphQLFieldConfigMap<unknown, unknown>): GraphQLSchema {
  return new GraphQLSchema({ query: new GraphQLObjectType({ name: 'Query', fields }) });
}

function answering(type: GraphQLOutputType, value: unknown): GraphQLSchema {
  return schemaOf({ answer: { type, resolve: () => value } });
}

function typeOf(node: JsonNode, definitions: JsonDefinitions = {}): string {
  return String(typesOfJsonSchema().outputOf(node, definitions, 'Answer'));
}

function printed(node: JsonNode, definitions: JsonDefinitions = {}): string {
  return printSchema(answering(typesOfJsonSchema().outputOf(node, definitions, 'Answer'), null));
}

function limitAnswering(value: unknown): GraphQLSchema {
  return answering(
    typesOfJsonSchema().outputOf({ anyOf: [{ type: 'string' }, { type: 'integer' }] }, {}, 'Limit'),
    value,
  );
}

const closed = (properties: JsonNode, required: readonly string[] = []): JsonNode => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const tagged = (kind: string, more: JsonNode): JsonNode =>
  closed({ kind: { type: 'string', enum: [kind] }, ...more }, ['kind', ...Object.keys(more)]);

describe('a JSON Schema as a GraphQL type', () => {
  it.each([
    ['a string', { type: 'string' }, 'String'],
    ['a string of a few values', { type: 'string', enum: ['active', 'retired'] }, 'String'],
    ['one constant', { const: 'only' }, 'String'],
    ['a number', { type: 'number' }, 'Float'],
    ['an integer, which may pass 32 bits', { type: 'integer' }, 'Float'],
    ['a number of a few values', { enum: [1, 2] }, 'Float'],
    ['a boolean', { type: 'boolean' }, 'Boolean'],
    ['a boolean constant', { enum: [true] }, 'Boolean'],
    ['values of mixed kinds', { enum: ['a', 1] }, 'JSON'],
    ['a string or null', { anyOf: [{ type: 'string' }, { type: 'null' }] }, 'String'],
    ['a string or null by its types', { type: ['string', 'null'] }, 'String'],
    ['a list of strings', { type: 'array', items: { type: 'string' } }, '[String!]'],
    ['a list of strings or nulls', { type: 'array', items: { type: ['string', 'null'] } }, '[String]'],
    ['a list of anything', { type: 'array' }, '[JSON]'],
    ['a free-form document', { type: 'object' }, 'JSON'],
    ['a typed map', { type: 'object', properties: {}, additionalProperties: { type: 'number' } }, 'JSON'],
    ['an object with fields and a map', { ...closed({ a: { type: 'string' } }), additionalProperties: true }, 'JSON'],
    ['an object with a field no GraphQL name takes', closed({ 'a-b': { type: 'string' } }), 'JSON'],
    ['an object with a field of a reserved name', closed({ __kind: { type: 'string' } }), 'JSON'],
    ['nothing said', {}, 'JSON'],
    ['null alone', { type: 'null' }, 'JSON'],
    ['an object or a string', { anyOf: [closed({ a: { type: 'string' } }), { type: 'string' }] }, 'JSON'],
    ['a string or a number', { anyOf: [{ type: 'string' }, { type: 'number' }] }, 'NumberOrString'],
    ['a boolean or a string', { type: ['boolean', 'string'] }, 'BooleanOrString'],
    [
      'a list of strings or of numbers',
      {
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'array', items: { type: 'number' } },
        ],
      },
      'JSON',
    ],
    ['two sets of strings', { anyOf: [{ enum: ['a'] }, { enum: ['b'] }] }, 'String'],
    ['every one of one string', { allOf: [{ type: 'string' }] }, 'String'],
    ['every one of one object', { allOf: [closed({ a: { type: 'string' } })] }, 'Answer'],
    ['every one of two', { allOf: [{ type: 'string' }, { minLength: 1 }] }, 'JSON'],
    ['an object and a free-form document', { anyOf: [closed({ a: { type: 'string' } }), { type: 'object' }] }, 'JSON'],
  ])('maps %s', (_, node, type) => {
    expect(typeOf(node)).toBe(type);
  });
});

describe('a JSON Schema as a GraphQL object type', () => {
  it('maps a closed object to an object type, each field non-null only where it is required and takes no null', () => {
    const node = closed(
      {
        id: { type: 'string', description: 'The id' },
        note: { type: 'string' },
        through: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        owner: closed({ name: { type: 'string' } }, ['name']),
      },
      ['id', 'through', 'owner'],
    );

    expect(printed(node)).toContain(
      [
        'type Answer {',
        '  """The id"""',
        '  id: String!',
        '  note: String',
        '  through: String',
        '  owner: AnswerOwner!',
        '}',
        '',
        'type AnswerOwner {',
        '  name: String!',
        '}',
      ].join('\n'),
    );
  });
});

describe('a JSON Schema’s definitions as GraphQL types', () => {
  it('names a type by its definition, makes it once for each use, and names another of the same name apart', () => {
    const types = typesOfJsonSchema();
    const definitions = { Note: closed({ text: { type: 'string' } }, ['text']) };
    const other = { Note: closed({ words: { type: 'string' } }, ['words']) };

    const first = types.outputOf({ $ref: '#/$defs/Note' }, definitions, 'First');
    const again = types.outputOf({ $ref: '#/$defs/Note', description: 'Again' }, definitions, 'Again');
    const apart = types.outputOf({ $ref: '#/$defs/Note' }, other, 'Apart');
    const unknown = types.outputOf({ $ref: '#/$defs/Missing' }, definitions, 'Unknown');
    const elsewhere = types.outputOf({ $ref: 'https://elsewhere/Note' }, definitions, 'Elsewhere');

    expect([String(first), String(again), String(apart), String(unknown), String(elsewhere)]).toEqual([
      'Note',
      'Note',
      'Note2',
      'JSON',
      'JSON',
    ]);
    expect(first).toBe(again);
  });
});

describe('a JSON Schema as a GraphQL union', () => {
  it('maps objects tagged by a constant to a union, each value answered as the member its tag names', async () => {
    const node = {
      anyOf: [
        tagged('text', { text: { type: 'string' } }),
        tagged('count', { count: { type: 'number' } }),
        { $ref: '#/$defs/Mark' },
      ],
    };
    const definitions = { Mark: tagged('mark', { at: { type: 'number' } }) };
    const schema = (value: unknown) => answering(typesOfJsonSchema().outputOf(node, definitions, 'Answer'), value);
    const asked = `{ answer { ... on AnswerText { text } ... on AnswerCount { count } ... on Mark { at } } }`;

    const types = typesOfJsonSchema();

    expect(printSchema(schema(null))).toContain('union Answer = AnswerText | AnswerCount | Mark');
    expect(types.outputOf(node, definitions, 'Answer')).toBe(types.outputOf(node, definitions, 'Answer'));
    expect(await graphql({ schema: schema({ kind: 'count', count: 3 }), source: asked })).toEqual({
      data: { answer: { count: 3 } },
    });
    expect(await graphql({ schema: schema({ kind: 'mark', at: 1 }), source: asked })).toEqual({
      data: { answer: { at: 1 } },
    });
    expect((await graphql({ schema: schema({ kind: 'other' }), source: asked })).errors).toHaveLength(1);
  });

  it('answers a union of untagged objects as the first member whose required fields the value has', async () => {
    const node = {
      anyOf: [
        closed({ url: { type: 'string' } }, ['url']),
        closed({ command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, ['command']),
      ],
    };
    const schema = (value: unknown) => answering(typesOfJsonSchema().outputOf(node, {}, 'Server'), value);
    const asked = '{ answer { ... on Server1 { url } ... on Server2 { command } } }';

    expect(await graphql({ schema: schema({ command: 'run' }), source: asked })).toEqual({
      data: { answer: { command: 'run' } },
    });
    expect((await graphql({ schema: schema('a string'), source: asked })).errors).toHaveLength(1);
  });
});

describe('a JSON Schema’s union of one', () => {
  it('maps a union of one object, and of one object twice, to that object', () => {
    const one = closed({ a: { type: 'string' } });

    expect([typeOf({ anyOf: [one, { type: 'null' }] }), typeOf({ anyOf: [one, one] })]).toEqual(['Answer', 'Answer']);
  });
});

describe('a JSON value answered', () => {
  it('answers a scalar of several kinds as given, and refuses a value of another kind', async () => {
    const schema = limitAnswering;

    expect(await graphql({ schema: schema(7), source: '{ answer }' })).toEqual({ data: { answer: 7 } });
    expect(await graphql({ schema: schema('none'), source: '{ answer }' })).toEqual({ data: { answer: 'none' } });
    expect((await graphql({ schema: schema(true), source: '{ answer }' })).errors).toHaveLength(1);
  });

  it('answers a free-form document as it is', async () => {
    const document = { a: [1, { b: null }] };
    const schema = answering(typesOfJsonSchema().outputOf({ type: 'object' }, {}, 'Data'), document);

    expect(await graphql({ schema, source: '{ answer }' })).toEqual({ data: { answer: document } });
  });

  it('adds the fields asked for to the object at a path below the root, through lists and nulls', () => {
    const types = typesOfJsonSchema();
    const node = closed({
      playbooks: { type: 'array', items: { anyOf: [{ $ref: '#/$defs/Playbook' }, { type: 'null' }] } },
      other: closed({ id: { type: 'string' } }),
    });
    const definitions = { Playbook: closed({ id: { type: 'string' } }, ['id']) };
    const answer = types.outputOf(node, definitions, 'Listed', [
      { id: 'notes', at: ['playbooks'], fields: () => ({ notes: { type: types.json } }) },
      { id: 'labels', at: ['playbooks'], fields: () => ({ labels: { type: types.json } }) },
      { id: 'elsewhere', at: ['missing'], fields: () => ({ never: { type: types.json } }) },
    ]);

    expect(printSchema(answering(answer, null))).toContain(
      ['type Playbook {', '  id: String!', '  notes: JSON', '  labels: JSON', '}'].join('\n'),
    );
    expect(printSchema(answering(answer, null))).toContain(['type ListedOther {', '  id: String', '}'].join('\n'));
  });
});
