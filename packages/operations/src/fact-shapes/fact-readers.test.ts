import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ActedContextSchema } from '../ledger/context.ts';
import { factOf } from '../ledger/decider.ts';
import { earlierShapeOf, readingEarlierShapes } from './earlier-shapes.ts';
import { factReaderOf, factTypesOf } from './fact-readers.ts';

const CountedBeforeSchema = factOf('tallied', Schema.Struct({ n: Schema.Int }), ActedContextSchema);

const CountedSchema = readingEarlierShapes(factOf('counted', Schema.Struct({ by: Schema.Int }), ActedContextSchema), [
  earlierShapeOf(CountedBeforeSchema, ({ data, context }) => ({
    type: 'counted' as const,
    data: { by: data.n },
    context,
  })),
]);

const NotedSchema = factOf('noted', Schema.Struct({ text: Schema.String }), ActedContextSchema);

const TallySchema = Schema.Union([CountedSchema, NotedSchema]);

const context = { at: '2026-10-29T10:00:00.000Z', by: 'user-1' };

describe('the fact types of a schema', () => {
  it('are the literal types its members are recorded with, those its readers read among them', () => {
    const AnyFactSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ActedContextSchema });

    expect(
      factTypesOf(Schema.Union([TallySchema, AnyFactSchema, Schema.Struct({ data: Schema.String }), Schema.Null])),
    ).toEqual(['counted', 'noted', 'tallied']);
  });
});

describe('a reader of the facts of a schema', () => {
  const read = factReaderOf(TallySchema);

  it('reads a fact of a type the schema reads, in its current shape or through the reader of an earlier one', () => {
    expect([
      read({ type: 'counted', data: { by: 2 }, context }),
      read({ type: 'tallied', data: { n: 3 }, context }),
      read({ type: 'noted', data: { text: 'kept' }, context }),
    ]).toEqual([
      { type: 'counted', data: { by: 2 }, context },
      { type: 'counted', data: { by: 3 }, context },
      { type: 'noted', data: { text: 'kept' }, context },
    ]);
  });

  it('passes over a record of a type the schema does not read, a record without a type and what is no record', () => {
    expect([
      read({ type: 'run_started', data: {}, context }),
      read({ data: { by: 2 }, context }),
      read('not a record'),
      read(null),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('refuses a fact of a type the schema reads in a shape no reader of it knows, as any unreadable fact', () => {
    expect(() => read({ type: 'counted', data: { count: 2 }, context })).toThrow('Missing key');
    expect(() => read({ type: 'noted', data: { text: 'kept' } })).toThrow('at ["context"]');
  });
});
