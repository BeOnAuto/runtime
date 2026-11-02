import { describe, expect, it } from 'vitest';

import {
  advertisedSchema,
  selfContainedSchemaOf,
  withEveryArgumentTyped,
  withoutUnreferencedDefinitions,
  type JsonSchema,
} from './tool-schema.ts';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const Playbook = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };

describe('selfContainedSchemaOf', () => {
  it('declares the dialect and leaves out $defs when there are no definitions', () => {
    expect(selfContainedSchemaOf({ schema: { type: 'object', properties: {} }, definitions: {} })).toEqual({
      $schema: dialect,
      type: 'object',
      properties: {},
    });
  });

  it('inlines a root that refers to a definition, so the root carries its properties, and keeps the definitions', () => {
    expect(
      selfContainedSchemaOf({ schema: { type: 'object', $ref: '#/$defs/Playbook' }, definitions: { Playbook } }),
    ).toEqual({ $schema: dialect, ...Playbook, $defs: { Playbook } });
  });

  it('hoists definitions that nested schemas refer to', () => {
    const schema = {
      type: 'object',
      properties: { playbooks: { type: 'array', items: { $ref: '#/$defs/Playbook' } } },
    };

    expect(selfContainedSchemaOf({ schema, definitions: { Playbook } })).toEqual({
      $schema: dialect,
      ...schema,
      $defs: { Playbook },
    });
  });

  it.each([
    ['refers outside the document', 'https://example.com/playbook.json'],
    ['refers to a definition the document lacks', '#/$defs/Missing'],
  ])('leaves a root that %s as it is', (_case, reference) => {
    expect(selfContainedSchemaOf({ schema: { type: 'object', $ref: reference }, definitions: { Playbook } })).toEqual({
      $schema: dialect,
      type: 'object',
      $ref: reference,
      $defs: { Playbook },
    });
  });
});

describe('withoutUnreferencedDefinitions', () => {
  const Tag = { type: 'string' };

  it('drops every definition when nothing refers to one, and with them $defs', () => {
    expect(withoutUnreferencedDefinitions({ type: 'object', $defs: { Tag } })).toEqual({ type: 'object' });
  });

  it('leaves a schema without definitions as it is', () => {
    expect(withoutUnreferencedDefinitions({ type: 'object' })).toEqual({ type: 'object' });
  });

  it('keeps the definitions referred to from the schema, from arrays in it and through other definitions', () => {
    const schema = {
      type: 'object',
      properties: { tags: { type: 'array', prefixItems: [{ $ref: '#/$defs/Labelled' }] } },
      $defs: {
        Labelled: { type: 'object', properties: { tag: { $ref: '#/$defs/Tag' } } },
        Tag,
        Unused: { type: 'number' },
      },
    };

    expect(withoutUnreferencedDefinitions(schema)).toEqual({
      ...schema,
      $defs: { Labelled: schema.$defs.Labelled, Tag },
    });
  });

  it('ignores a reference outside the definitions, and a $ref that is not a string', () => {
    const schema = {
      properties: { remote: { $ref: 'https://example.com/tag.json' }, odd: { $ref: { $ref: '#/$defs/Tag' } } },
      $defs: { Tag, Unused: { type: 'number' } },
    };

    expect(withoutUnreferencedDefinitions(schema)).toEqual({ ...schema, $defs: { Tag } });
  });
});

describe('advertisedSchema', () => {
  it('advertises the schema it is given as its JSON Schema, and accepts any value so the operation validates', () => {
    const { '~standard': standard } = advertisedSchema({ $schema: dialect, type: 'object' });
    expect({
      vendor: standard.vendor,
      input: standard.jsonSchema.input({ target: 'draft-2020-12' }),
      output: standard.jsonSchema.output({ target: 'draft-07' }),
      validated: standard.validate({ anything: 1 }),
    }).toEqual({
      vendor: 'on.auto',
      input: { $schema: dialect, type: 'object' },
      output: { $schema: dialect, type: 'object' },
      validated: { value: { anything: 1 } },
    });
  });
});

describe('withEveryArgumentTyped', () => {
  const everyJsonType = ['object', 'array', 'string', 'number', 'boolean', 'null'];

  it('gives an argument that says nothing of what it takes every JSON type, nested arguments too', () => {
    const schema = {
      type: 'object',
      properties: {
        answer: { description: 'Any answer' },
        event: { type: 'object', properties: { data: {} } },
      },
    };

    expect(withEveryArgumentTyped(schema)).toEqual({
      type: 'object',
      properties: {
        answer: { type: everyJsonType, description: 'Any answer' },
        event: { type: 'object', properties: { data: { type: everyJsonType } } },
      },
    });
  });

  it.each<readonly [string, Readonly<JsonSchema>]>([
    ['a type', { type: 'string' }],
    ['a reference', { $ref: '#/$defs/Playbook' }],
    ['a choice of schemas', { anyOf: [{ type: 'string' }, { type: 'null' }] }],
    ['its values', { enum: ['first', 'second'] }],
    ['a constant', { const: 'only' }],
  ])('leaves an argument that names %s as it is', (_case, argument) => {
    expect(withEveryArgumentTyped({ type: 'object', properties: { argument } })).toEqual({
      type: 'object',
      properties: { argument },
    });
  });

  it('leaves a boolean schema and a schema without properties as they are', () => {
    expect(withEveryArgumentTyped({ type: 'object', properties: { anything: true } })).toEqual({
      type: 'object',
      properties: { anything: true },
    });
    expect(withEveryArgumentTyped({ type: 'string' })).toEqual({ type: 'string' });
  });
});
