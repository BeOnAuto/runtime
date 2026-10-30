import { ContextSchema, type Fold, type Ledger } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

const AnyEventSchema = Schema.Struct({ type: Schema.String, data: Schema.Unknown, context: ContextSchema });

interface Starts {
  readonly events: number;
  readonly first: number | undefined;
}

const firstStartFold: Fold<Starts, typeof AnyEventSchema.Type> = {
  initialState: { events: 0, first: undefined },
  eventSchema: AnyEventSchema,
  evolve: ({ events, first }, { type }) => ({
    events: events + 1,
    first: first ?? (type === 'run_started' ? events + 1 : undefined),
  }),
};

export function firstStartIn(ledger: Ledger['Service'], stream: string): Effect.Effect<number | undefined> {
  return Effect.map(ledger.load(stream, firstStartFold), ({ state }) => state.first);
}
