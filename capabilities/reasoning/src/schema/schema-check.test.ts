import { describe, expect, it } from 'vitest';

import { notPortableAsToolInput } from './answer-schema.ts';
import { checkAnswerSchema } from './schema-report.ts';

const anthropicModels = ['anthropic', 'bedrock', 'bedrock-anthropic', 'vertex-anthropic'];
const strictOpenAi = ['openai', 'azure'];
const nothingToReport = { unsupported: [], not_portable: [], unchecked: [] };

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
  it('finds nothing to report in a schema the portable form carries: open, optional, bounded or not an object', () => {
    const loose = {
      type: 'object',
      properties: { summary: { type: 'string', maxLength: 80 }, total: { type: 'number', minimum: 0 } },
      required: ['summary'],
    };

    expect([
      checkAnswerSchema(portable),
      checkAnswerSchema(loose),
      checkAnswerSchema({ type: 'array', items: { type: 'string' } }),
    ]).toEqual([nothingToReport, nothingToReport, nothingToReport]);
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

  it('reports what the portable form cannot carry, at its pointer in the schema as written', () => {
    expect(checkAnswerSchema(withProperty('payload', {})).not_portable).toEqual([
      { pointer: '/properties/payload', detail: 'a value of any type' },
    ]);
  });
});

describe('checkAnswerSchema for keywords it does not check', () => {
  it('reports nothing of a format the runtime checks, and refuses a format it does not check', () => {
    expect([checkAnswerSchema(withFormat('email')), checkAnswerSchema(withFormat('phone'))]).toEqual([
      nothingToReport,
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

  it('reports extension keywords', () => {
    expect(checkAnswerSchema({ ...portable, propertyOrdering: ['summary'], nullable: true }).unchecked).toEqual([
      {
        pointer: '/propertyOrdering',
        detail: 'propertyOrdering is not a keyword the runtime checks; answers are not checked against it',
      },
      {
        pointer: '/nullable',
        detail: 'nullable is not a keyword the runtime checks; answers are not checked against it',
      },
    ]);
  });
});

describe('notPortableAsToolInput', () => {
  it('asks for an object at the root', () => {
    expect(notPortableAsToolInput({ type: 'array', items: { type: 'string' } })).toEqual([
      {
        pointer: '/type',
        detail: 'The root of the schema should be "type": "object"',
        providers: [...anthropicModels, ...strictOpenAi],
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

  it('names a oneOf whose arguments Anthropic models are not held to', () => {
    expect(notPortableAsToolInput(withProperty('owner', { oneOf: [{ type: 'string' }, { type: 'null' }] }))).toEqual([
      {
        pointer: '/properties/owner/oneOf',
        detail:
          "oneOf is not enforced while Anthropic models write a tool's arguments; arguments matching more than one branch reach the tool, which may refuse them",
        providers: anthropicModels,
      },
    ]);
  });
});

describe('notPortableAsToolInput across the whole schema', () => {
  it('walks definitions, lists of schemas and single subschemas in document order', () => {
    const nested = {
      type: 'object',
      $defs: { short: { type: 'string', maxLength: 3 } },
      properties: {
        choice: { anyOf: [{ type: 'string', minLength: 1 }] },
        list: {
          type: 'array',
          items: { type: 'integer', maximum: 9 },
          prefixItems: [{ type: 'string', minLength: 1 }],
        },
        names: { type: 'object', additionalProperties: false, propertyNames: { maxLength: 3 } },
      },
    };

    expect(notPortableAsToolInput(nested).map(({ pointer }) => pointer)).toEqual([
      '/properties/choice/anyOf/0/minLength',
      '/properties/list/items/maximum',
      '/properties/list/prefixItems/0/minLength',
      '/properties/names/propertyNames/maxLength',
      '/$defs/short/maxLength',
    ]);
  });
});
