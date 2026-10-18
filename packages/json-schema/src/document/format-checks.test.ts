import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { compiled, fieldIssues, formatRefusal } from '../testing/compiled-fields.ts';
import { compileJsonSchema, type Validation } from './json-schema.ts';

describe('a format beside a value that is not a string', () => {
  it('asserts nothing, whatever the type beside it, and asserts the form of a string the type allows', () => {
    expect([
      fieldIssues({ type: 'integer', format: 'date' }, 5),
      fieldIssues({ format: 'date' }, 5),
      fieldIssues({ format: 'date' }, { day: 1 }),
      fieldIssues({ type: ['string', 'null'], format: 'date' }, null),
      fieldIssues({ type: ['string', 'null'], format: 'date' }, 'April'),
      fieldIssues({ format: 'date' }, 'April'),
      fieldIssues({ format: 'date', minLength: 1 }, 'April'),
    ]).toEqual([[], [], [], [], [formatRefusal('date')], [formatRefusal('date')], [formatRefusal('date')]]);
  });
});

describe('a format a definition or a reference holds', () => {
  it('is checked in a definition, beside a reference, in the items of a list or a tuple and in the entries of a record', () => {
    const schema = compiled({
      type: 'object',
      $defs: { day: { type: 'string', format: 'date' }, text: { type: 'string' } },
      properties: {
        due: { $ref: '#/$defs/day' },
        contact: { $ref: '#/$defs/text', format: 'email' },
        days: { type: 'array', items: { $ref: '#/$defs/day' } },
        slot: { type: 'array', prefixItems: [{ type: 'string', format: 'time' }] },
        links: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
      },
    });

    expect(
      schema.issuesOf({
        due: 'soon',
        contact: 'ada',
        days: ['2026-04-01', 'later'],
        slot: ['noon'],
        links: { a: 'x' },
      }),
    ).toEqual([
      formatRefusal('date', '/due'),
      formatRefusal('email', '/contact'),
      formatRefusal('date', '/days/1'),
      formatRefusal('time', '/slot/0'),
      formatRefusal('uri', '/links/a'),
    ]);
    expect(schema.issuesOf({ contact: 5 })).toEqual([
      { pointer: '/contact', detail: 'Expected text', breach: { rule: 'kind' } },
    ]);
  });
});

describe('a format joined with other schemas', () => {
  it('is checked in the branches of anyOf, among the values of an enum and through allOf', () => {
    expect([
      fieldIssues({ anyOf: [{ type: 'string', format: 'uuid' }, { type: 'integer' }] }, 'x'),
      fieldIssues({ type: 'string', format: 'date', enum: ['2026-04-01', 'tomorrow'] }, 'tomorrow'),
      fieldIssues({ type: 'string', format: 'date', enum: ['2026-04-01', 'tomorrow'] }, '2026-04-01'),
      fieldIssues({ type: 'string', allOf: [{ format: 'time' }] }, 'noon'),
      fieldIssues({ type: 'string', allOf: [{ type: 'string', minLength: 1, format: 'time' }] }, 'noon'),
      fieldIssues({ type: 'string', allOf: [{ type: 'string', minLength: 1, maxLength: 9, format: 'time' }] }, 'noon'),
      fieldIssues(
        { type: 'string', format: 'uri', allOf: [{ type: 'string', minLength: 1, format: 'email' }] },
        'name@example.com',
      ),
    ]).toEqual([
      [formatRefusal('uuid')],
      [formatRefusal('date')],
      [],
      [formatRefusal('time')],
      [formatRefusal('time')],
      [formatRefusal('time')],
      [formatRefusal('uri')],
    ]);
  });
});

describe('a format deep in a schema', () => {
  it('is checked in every level of a recursive definition, and for a name the schema bounds, as a name', () => {
    const tree = compiled({
      $defs: {
        node: {
          type: 'object',
          properties: {
            at: { type: 'string', format: 'date-time' },
            children: { type: 'array', items: { $ref: '#/$defs/node' } },
          },
        },
      },
      $ref: '#/$defs/node',
    });

    expect(tree.issuesOf({ at: '2026-04-01T09:30:00Z', children: [{ children: [{ at: 'now' }] }] })).toEqual([
      formatRefusal('date-time', '/children/0/children/0/at'),
    ]);
    expect(fieldIssues({ type: 'object', propertyNames: { format: 'date' } }, { '2026-04-01': 1, soon: 2 })).toEqual([
      { ...formatRefusal('date', '/field/soon'), ofTheName: true },
    ]);
  });
});

function compileIssues(document: unknown, validation: Validation): unknown {
  return Result.match(compileJsonSchema(document, validation), { onSuccess: () => [], onFailure: (issues) => issues });
}

describe('a format the compiler does not check', () => {
  const tool = {
    type: 'object',
    properties: { count: { type: 'integer', format: 'int64' }, day: { type: 'string', format: 'date' } },
  };
  const leavingOtherFormats: Validation = { what: 'arguments object', nesting: 64, otherFormats: 'unchecked' };

  it('is refused at its pointer, unless the compiler is told to leave it unchecked, and then checks the six alone', () => {
    const unchecked = Result.getOrThrow(compileJsonSchema(tool, leavingOtherFormats));

    expect(compileIssues(tool, { what: 'input', nesting: 64 })).toEqual([
      {
        pointer: '/properties/count/format',
        detail: 'Expected one of the formats checked here: date, date-time, time, email, uri or uuid',
      },
    ]);
    expect([
      unchecked.issuesOf({ count: 7, day: '2026-04-01' }),
      unchecked.issuesOf({ count: 'x', day: 'Friday' }),
    ]).toEqual([
      [],
      [{ pointer: '/count', detail: 'Expected number', breach: { rule: 'kind' } }, formatRefusal('date', '/day')],
    ]);
  });

  it('is refused either way when it is not text', () => {
    expect(compileIssues({ format: 7 }, leavingOtherFormats)).toEqual([
      { pointer: '/format', detail: 'Expected a string' },
    ]);
  });
});
