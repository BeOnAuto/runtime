import { ActedContextSchema, Conflict, factOf, type Decided, type Decider } from '@on.auto/operations';
import { Effect, Result, Schema, SchemaGetter } from 'effect';

import { stamped } from './happenings.ts';

const CountedSchema = factOf('counted', Schema.Struct({ by: Schema.Int }), ActedContextSchema);

type Counted = typeof CountedSchema.Type;

export type Amounts = readonly number[];

function decided(amounts: Amounts, total: number): Result.Result<readonly Decided<Counted>[], Conflict> {
  const reached = amounts.reduce((running, amount) => running + amount, total);
  return reached < 0
    ? Result.fail(new Conflict({ detail: `A tally of ${total} cannot fall to ${reached}` }))
    : Result.succeed(amounts.map((by) => ({ type: 'counted', data: { by } })));
}

export const tally: Decider<number, Amounts, Counted, 'conflict'> = {
  initialState: 0,
  evolve: (total, { data }) => total + data.by,
  decide: decided,
  context: () => stamped,
  eventSchema: CountedSchema,
};

export function tallyInterruptedBy(
  interruption: Effect.Effect<unknown>,
  times: number,
): Decider<number, Amounts, Counted, 'conflict'> {
  let remaining = times;
  const interruptOnce = Effect.suspend(() => {
    remaining -= 1;
    return remaining >= 0 ? interruption : Effect.void;
  });
  return {
    ...tally,
    eventSchema: CountedSchema.pipe(
      Schema.decodeTo(Schema.toType(CountedSchema), {
        decode: SchemaGetter.passthrough(),
        encode: SchemaGetter.transformEffect((counted: Counted) => Effect.as(interruptOnce, counted)),
      }),
    ),
  };
}
