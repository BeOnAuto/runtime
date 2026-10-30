import { describe, expect, it } from 'vitest';

import { declarationOf } from './schema-types.ts';

describe('the types of a document’s schemas', () => {
  it('closes an object unless its schema opens it, and marks what it does not require optional', () => {
    expect(
      declarationOf('Input', {
        type: 'object',
        required: ['period'],
        properties: { period: { type: 'integer' }, 'two words': { type: 'string' } },
      }),
    ).toBe('type Input = { period: number; "two words"?: string; };');
    expect(
      declarationOf('Input', { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: true }),
    ).toBe('type Input = { id?: string; [key: string]: Json; };');
  });

  it('writes an object of no properties as a record of its additional properties', () => {
    expect(declarationOf('View', { type: 'object', additionalProperties: { type: 'number' } })).toBe(
      'type View = { [key: string]: number };',
    );
    expect(declarationOf('View', { type: 'object' })).toBe('type View = { [key: string]: Json };');
    expect(declarationOf('View', { additionalProperties: false })).toBe('type View = Record<string, never>;');
  });

  it('keeps a bounded list a list and writes a list of fixed places as a tuple', () => {
    expect(declarationOf('Output', { type: 'array', maxItems: 20, items: { type: 'string' } })).toBe(
      'type Output = string[];',
    );
    expect(declarationOf('Output', { items: true })).toBe('type Output = Json[];');
    expect(declarationOf('Output', { type: 'array' })).toBe('type Output = Json[];');
    expect(
      declarationOf('Output', { type: 'array', prefixItems: [{ type: 'string' }, { type: 'boolean' }], items: false }),
    ).toBe('type Output = [string, boolean];');
    expect(declarationOf('Output', { prefixItems: [{ type: 'null' }], items: { type: 'number' } })).toBe(
      'type Output = [null, ...number[]];',
    );
  });
});

describe('the types of values and combinations', () => {
  it('writes listed and constant values as literals, and combinations as unions and intersections', () => {
    expect(declarationOf('Input', { enum: ['approve', 'reject', null] })).toBe(
      'type Input = ("approve" | "reject" | null);',
    );
    expect(declarationOf('Input', { const: 3 })).toBe('type Input = 3;');
    expect(declarationOf('Input', { type: ['string', 'null'] })).toBe('type Input = (string | null);');
    expect(declarationOf('Input', { anyOf: [{ type: 'string' }, { type: 'string' }] })).toBe('type Input = string;');
    expect(declarationOf('Input', { oneOf: [{ type: 'string' }, false] })).toBe('type Input = (string | never);');
    expect(
      declarationOf('Input', {
        type: 'object',
        allOf: [{ properties: { a: { type: 'number' } } }, { properties: { b: { type: 'number' } } }],
      }),
    ).toBe('type Input = ({ [key: string]: Json } & { a?: number; } & { b?: number; });');
    expect(declarationOf('Input', { not: {} })).toBe('type Input = never;');
    expect(declarationOf('Input', {})).toBe('type Input = Json;');
    expect(declarationOf('Input')).toBe('type Input = Json;');
  });

  it('names each definition after its schema and the definition, so a reference may recur', () => {
    expect(
      declarationOf('Input', {
        $defs: { 'street-address': { type: 'object', properties: { next: { $ref: '#/$defs/street-address' } } } },
        definitions: { city: { type: 'string' } },
        type: 'object',
        properties: { home: { $ref: '#/$defs/street-address' }, city: { $ref: '#/definitions/city' } },
      }),
    ).toBe(
      [
        'type Input_city = string;',
        'type Input_street$45$address = { next?: Input_street$45$address; };',
        'type Input = { home?: Input_street$45$address; city?: Input_city; };',
      ].join('\n'),
    );
  });
});
