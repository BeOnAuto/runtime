import { describe, expect, it } from 'vitest';

import { checkAnswerSchema, notPortableAsToolInput } from './answer-schema.ts';

const anthropicModels = ['anthropic', 'bedrock', 'bedrock-anthropic', 'vertex-anthropic'];
const strictOpenAi = ['openai', 'azure'];
const openObject = 'An object should set "additionalProperties": false; strict structured outputs reject open objects';

const portable = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One sentence' },
    priority: { enum: ['low', 'high'] },
    owner: { type: ['string', 'null'] },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'priority', 'owner', 'steps'],
  additionalProperties: false,
};

function withProperty(name: string, schema: object): object {
  return { ...portable, properties: { ...portable.properties, [name]: schema } };
}

function withFormat(format: string): object {
  return withProperty('owner', { type: 'string', format });
}

describe('checkAnswerSchema', () => {
  it('finds nothing to report in a schema within the portable subset', () => {
    expect(checkAnswerSchema(portable)).toEqual({ unsupported: [], not_portable: [], unchecked: [] });
  });

  it('reports a schema it cannot validate, and nothing else', () => {
    expect(checkAnswerSchema({ type: 'string', pattern: 'x' })).toEqual({
      unsupported: [
        {
          pointer: '/pattern',
          detail: 'Regular expressions are not accepted, because a hostile pattern can stall validation',
        },
      ],
      not_portable: [],
      unchecked: [],
    });
  });

  it('asks for an object at the root', () => {
    expect(checkAnswerSchema({ type: 'array', items: { type: 'string' } }).not_portable).toEqual([
      {
        pointer: '/type',
        detail: 'The root of the schema should be "type": "object"',
        providers: [...anthropicModels, ...strictOpenAi],
      },
    ]);
  });
});

describe('checkAnswerSchema for strict structured outputs', () => {
  it('asks for closed objects with every property required', () => {
    const open = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] };

    expect(checkAnswerSchema(open).not_portable).toEqual([
      { pointer: '', detail: openObject, providers: strictOpenAi },
      {
        pointer: '/required',
        detail: 'Every property should be required (make an optional one nullable instead): b',
        providers: strictOpenAi,
      },
    ]);
  });

  it('treats a schema with properties but no type as an object', () => {
    const untyped = {
      type: 'object',
      properties: { inner: { properties: {} } },
      required: ['inner'],
      additionalProperties: false,
    };

    expect(checkAnswerSchema(untyped).not_portable).toEqual([
      { pointer: '/properties/inner', detail: openObject, providers: strictOpenAi },
    ]);
  });
});

describe('checkAnswerSchema for Anthropic models', () => {
  it('warns that bounds are not enforced', () => {
    expect(checkAnswerSchema(withProperty('summary', { type: 'string', maxLength: 80 })).not_portable).toEqual([
      {
        pointer: '/properties/summary/maxLength',
        detail:
          'maxLength is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid',
        providers: anthropicModels,
      },
    ]);
  });

  it('warns that oneOf becomes anyOf', () => {
    const choice = withProperty('owner', { oneOf: [{ type: 'string' }, { type: 'null' }] });

    expect(checkAnswerSchema(choice).not_portable).toEqual([
      {
        pointer: '/properties/owner/oneOf',
        detail:
          'oneOf is sent to Anthropic models as anyOf; an answer matching more than one branch fails as output_invalid',
        providers: anthropicModels,
      },
    ]);
  });
});

describe('checkAnswerSchema for keywords it does not check', () => {
  it('reports nothing of a format the runtime checks, and refuses a format it does not check', () => {
    expect([checkAnswerSchema(withFormat('email')), checkAnswerSchema(withFormat('phone'))]).toEqual([
      { unsupported: [], not_portable: [], unchecked: [] },
      {
        unsupported: [
          {
            pointer: '/properties/owner/format',
            detail: 'Expected one of the formats checked here: date, date-time, time, email, uri or uuid',
          },
        ],
        not_portable: [],
        unchecked: [],
      },
    ]);
  });

  it('names a format a provider does not accept in the input schema of a tool, which reasoning does not compile', () => {
    expect(notPortableAsToolInput(withFormat('phone'))).toEqual([
      {
        pointer: '/properties/owner/format',
        detail: 'Anthropic models do not accept this format',
        providers: anthropicModels,
      },
    ]);
  });

  it('reports extension keywords', () => {
    expect(checkAnswerSchema({ ...portable, propertyOrdering: ['summary'], nullable: true }).unchecked).toEqual([
      {
        pointer: '/propertyOrdering',
        detail: 'propertyOrdering is not a keyword this package checks; it is sent to the provider as written',
      },
      {
        pointer: '/nullable',
        detail: 'nullable is not a keyword this package checks; it is sent to the provider as written',
      },
    ]);
  });
});

describe('checkAnswerSchema across the whole schema', () => {
  it('walks definitions, lists of schemas and single subschemas in document order', () => {
    const nested = {
      type: 'object',
      $defs: { open: { type: 'object' } },
      properties: {
        choice: { anyOf: [{ type: 'object' }] },
        list: { type: 'array', items: { type: 'object' }, prefixItems: [{ type: 'string', minLength: 1 }] },
        names: { type: 'object', additionalProperties: false, propertyNames: { maxLength: 3 } },
      },
      required: ['choice', 'list', 'names'],
      additionalProperties: false,
    };

    expect(checkAnswerSchema(nested).not_portable.map(({ pointer }) => pointer)).toEqual([
      '/properties/choice/anyOf/0',
      '/properties/list/items',
      '/properties/list/prefixItems/0/minLength',
      '/properties/names/propertyNames/maxLength',
      '/$defs/open',
    ]);
  });
});
