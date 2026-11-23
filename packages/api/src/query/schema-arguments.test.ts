import { GraphQLObjectType, GraphQLSchema, graphql, printSchema, type GraphQLFieldConfigMap } from 'graphql';
import { describe, expect, it } from 'vitest';

import { typesOfJsonSchema, type JsonNode } from './schema-types.ts';

function schemaOf(fields: GraphQLFieldConfigMap<unknown, unknown>): GraphQLSchema {
  return new GraphQLSchema({ query: new GraphQLObjectType({ name: 'Query', fields }) });
}

const closed = (properties: JsonNode, required: readonly string[] = []): JsonNode => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

describe('the input of a JSON Schema as GraphQL arguments', () => {
  it('maps each field to an argument, non-null where it is required and takes no null', () => {
    const input = closed(
      {
        name: { type: 'string', description: 'The name' },
        limit: { type: 'integer' },
        retired: { type: 'boolean' },
        kind: { anyOf: [{ enum: ['a'] }, { enum: ['b'] }] },
        order: { type: 'string', enum: ['asc', 'desc'] },
        tags: { type: 'array', items: { type: 'string' } },
        filter: closed({ a: { type: 'string' } }),
        since: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        sized: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        shape: { anyOf: [{ type: 'string' }, closed({ a: { type: 'string' } })] },
        reference: { $ref: '#/$defs/Name' },
        missing: { $ref: '#/$defs/Missing' },
        rows: { type: 'array', items: closed({ a: { type: 'string' } }) },
        measure: { type: ['number', 'string'] },
        'not-a-name': { type: 'string' },
      },
      ['name', 'since'],
    );
    const types = typesOfJsonSchema();
    const fields = { read: { type: types.json, args: types.argumentsOf(input, { Name: { type: 'string' } }) } };

    expect(printSchema(schemaOf(fields))).toContain(
      [
        '  read(',
        '    """The name"""',
        '    name: String!',
        '    limit: Float',
        '    retired: Boolean',
        '    kind: String',
        '    order: String',
        '    tags: [String!]',
        '    filter: JSON',
        '    since: String',
        '    sized: NumberOrString',
        '    shape: JSON',
        '    reference: String',
        '    missing: JSON',
        '    rows: JSON',
        '    measure: NumberOrString',
        '  ): JSON',
      ].join('\n'),
    );
  });
});

describe('the arguments of a JSON Schema, given', () => {
  it('takes a scalar of several kinds and a free-form document as literals and as variables', async () => {
    const types = typesOfJsonSchema();
    const input = closed({
      sized: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      document: { type: 'object' },
    });
    const schema = schemaOf({
      read: {
        type: types.json,
        args: types.argumentsOf(input, {}),
        resolve: (_source, args: Readonly<Record<string, unknown>>) => ({ ...args }),
      },
    });

    expect(await graphql({ schema, source: '{ read(sized: 3, document: { a: [1, "b", true, null] }) }' })).toEqual({
      data: { read: { sized: 3, document: { a: [1, 'b', true, null] } } },
    });
    expect(
      await graphql({
        schema,
        source: 'query ($sized: NumberOrString, $document: JSON) { read(sized: $sized, document: $document) }',
        variableValues: { sized: 'large', document: { b: 2 } },
      }),
    ).toEqual({ data: { read: { sized: 'large', document: { b: 2 } } } });
    expect((await graphql({ schema, source: '{ read(sized: true) }' })).errors).toHaveLength(1);
    expect((await graphql({ schema, source: '{ read(sized: [1]) }' })).errors).toHaveLength(1);
    expect(
      (
        await graphql({
          schema,
          source: 'query ($sized: NumberOrString) { read(sized: $sized) }',
          variableValues: { sized: [] },
        })
      ).errors,
    ).toHaveLength(1);
  });
});
