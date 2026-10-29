import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ActedContextSchema } from '../ledger/context.ts';
import { factOf, recordingOf } from '../ledger/decider.ts';
import { earlierShapeOf, readingEarlierShapes } from './earlier-shapes.ts';

const CountedBeforeSchema = factOf('counted', Schema.Struct({ n: Schema.Int }), ActedContextSchema);

const CountedOnceSchema = factOf('counted', Schema.Struct({ by: Schema.Int, unit: Schema.String }), ActedContextSchema);

const CountedNowSchema = factOf(
  'counted',
  Schema.Struct({ by: Schema.Int, unit: Schema.String, note: Schema.String }),
  ActedContextSchema,
);

const CountedSchema = readingEarlierShapes(CountedNowSchema, [
  earlierShapeOf(CountedOnceSchema, ({ data, ...fact }) => ({ ...fact, data: { ...data, note: '' } })),
  earlierShapeOf(CountedBeforeSchema, ({ data, ...fact }) => ({
    ...fact,
    data: { by: data.n, unit: 'tally', note: '' },
  })),
]);

const json = Schema.toCodecJson(CountedSchema);

const read = Schema.decodeUnknownEffect(json);

const written = Schema.encodeUnknownEffect(json);

const context = { at: '2026-10-29T10:00:00.000Z', by: 'user-1' };

describe('a fact read in the shapes it was recorded in', () => {
  it('is read in its current shape first', async () => {
    const recorded = { type: 'counted', data: { by: 2, unit: 'tally', note: 'kept' }, context };

    expect(await Effect.runPromise(read(recorded))).toEqual(recorded);
  });

  it('is read in each earlier shape in turn, raised to the current shape by the reader of that shape', async () => {
    const once = { type: 'counted', data: { by: 4, unit: 'crate' }, context };
    const before = { type: 'counted', data: { n: 3 }, context };

    expect(await Effect.runPromise(read(once))).toEqual({ ...once, data: { by: 4, unit: 'crate', note: '' } });
    expect(await Effect.runPromise(read(before))).toEqual({ ...before, data: { by: 3, unit: 'tally', note: '' } });
  });

  it('is refused in a shape it was never recorded in', async () => {
    const result = await Effect.runPromise(Effect.result(read({ type: 'counted', data: { count: 3 }, context })));

    expect(result).toMatchObject({ _tag: 'Failure' });
  });
});

const raisingRefused: unknown = expect.stringContaining(
  'The reader of an earlier shape could not raise the fact: Error: no unit to count n in',
);

describe('a fact whose reader throws', () => {
  it('is refused in the earlier shape of that reader, as a fact of no shape it knows, and never thrown', () => {
    const refusing = readingEarlierShapes(CountedNowSchema, [
      earlierShapeOf(CountedBeforeSchema, (): typeof CountedNowSchema.Type => {
        throw new Error('no unit to count n in');
      }),
    ]);

    const result = Schema.decodeUnknownResult(Schema.toCodecJson(refusing))({
      type: 'counted',
      data: { n: 3 },
      context,
    });

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { message: raisingRefused },
    });
  });
});

describe('a fact written', () => {
  it('is written in its current shape alone, and never in an earlier one', async () => {
    const fact = { type: 'counted' as const, data: { by: 5, unit: 'tally', note: 'kept' }, context };
    const recorded = recordingOf(CountedSchema)({ type: 'counted', data: fact.data }, context);

    expect(await Effect.runPromise(written(recorded))).toEqual(fact);
    expect(await Effect.runPromise(Effect.result(written({ type: 'counted', data: { n: 3 }, context })))).toMatchObject(
      { _tag: 'Failure' },
    );
  });
});
