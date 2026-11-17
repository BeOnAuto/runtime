import { describe, expect, it } from 'vitest';

import { declaredAt } from './schema-places.ts';
import { encodingOf } from './sent-encodings.ts';

const schema = {
  type: 'object',
  properties: {
    content: { type: 'string', description: 'The words of the file' },
    file: { type: 'string', contentEncoding: 'BASE64' },
    bytes: { type: 'string', format: 'byte' },
    rows: { type: 'array', items: { type: 'object' } },
    pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'object' }], items: { type: 'number' } },
    tuple: { type: 'array', items: [{ type: 'string' }], additionalItems: { type: 'object' } },
    either: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/upload' }] },
    both: { allOf: [{ $ref: '#/definitions/text' }, { description: 'Kept short' }] },
    loop: { $ref: '#/$defs/loop' },
    elsewhere: { $ref: 'https://example.com/schema.json' },
    named: { type: 'object', additionalProperties: { type: 'string' } },
    anything: {},
    nullable: { type: ['string', 'null', 7] },
    pointless: { $ref: '#/properties/content/type' },
    through: { $ref: '#/properties/content/type/deeper' },
  },
  $defs: { upload: { type: 'string', contentEncoding: 'base64' }, loop: { $ref: '#/$defs/loop' } },
  definitions: { text: { type: 'string' } },
} as const;

function at(pointer: string) {
  return declaredAt(schema, pointer);
}

function declared(pointer: string) {
  const { base64, types } = declaredAt(schema, pointer);
  return { base64, types: types === 'any' ? 'any' : [...types].toSorted() };
}

describe('what a tool’s schema declares at an argument', () => {
  it('reads the types and the base64 a place declares, through properties, items, references and choices', () => {
    expect(
      [
        '/content',
        '/file',
        '/bytes',
        '/rows/3',
        '/pair/0',
        '/pair/1',
        '/pair/5',
        '/tuple/0',
        '/tuple/2',
        '/either',
        '/both',
        '/named/a~1b',
        '/nullable',
      ].map((pointer) => declared(pointer)),
    ).toEqual([
      { base64: false, types: ['string'] },
      { base64: true, types: ['string'] },
      { base64: true, types: ['string'] },
      { base64: false, types: ['object'] },
      { base64: false, types: ['string'] },
      { base64: false, types: ['object'] },
      { base64: false, types: ['number'] },
      { base64: false, types: ['string'] },
      { base64: false, types: ['object'] },
      { base64: true, types: ['string'] },
      { base64: false, types: ['string'] },
      { base64: false, types: ['string'] },
      { base64: false, types: ['null', 'string'] },
    ]);
  });

  it('declares anything where no schema says a type, as for an argument it does not name or a reference it cannot follow', () => {
    expect(
      ['/anything', '/unnamed', '/loop', '/elsewhere', '/rows/first', '/content/0', '/pointless', '/through'].map(
        (pointer) => declared(pointer),
      ),
    ).toEqual(Array.from({ length: 8 }, () => ({ base64: false, types: 'any' })));
  });
});

describe('how an asset is written where a tool takes it', () => {
  it('is base64 where the schema says so, a JSON value where it takes a list or an object, and text where it takes a string', () => {
    expect([
      encodingOf('file', at('/file')),
      encodingOf('text', at('/bytes')),
      encodingOf('json', at('/rows')),
      encodingOf('json', at('/content')),
      encodingOf('json', at('/anything')),
      encodingOf('text', at('/content')),
      encodingOf('text', at('/anything')),
    ]).toEqual(['base64', 'base64', 'json', 'text', 'json', 'text', 'text']);
  });

  it('is nothing for a file where no base64 is declared, or a text where only a list or a number is', () => {
    expect([
      encodingOf('file', at('/content')),
      encodingOf('file', at('/anything')),
      encodingOf('text', at('/rows')),
      encodingOf('json', at('/pair/5')),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
