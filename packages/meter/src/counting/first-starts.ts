import { ContextSchema, type Fold, type Ledger } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { FirstStartOf } from './run-starts.ts';

const AnyEventSchema = Schema.Struct({ type: Schema.String, data: Schema.Unknown, context: ContextSchema });

const StartedInSchema = Schema.Struct({ playbook: Schema.String });

const decodeStartedIn = Schema.decodeUnknownEffect(StartedInSchema);

interface StartRead {
  readonly version: number;
  readonly data: unknown;
}

interface Starts {
  readonly events: number;
  readonly first: StartRead | undefined;
}

const firstStartFold: Fold<Starts, typeof AnyEventSchema.Type> = {
  initialState: { events: 0, first: undefined },
  eventSchema: AnyEventSchema,
  evolve: ({ events, first }, { type, data }) => ({
    events: events + 1,
    first: first ?? (type === 'run_started' ? { version: events + 1, data } : undefined),
  }),
};

export function firstStartIn(ledger: Ledger['Service'], stream: string): Effect.Effect<StartRead | undefined> {
  return Effect.map(ledger.load(stream, firstStartFold), ({ state }) => state.first);
}

export function firstStartsIn(ledger: Ledger['Service']): FirstStartOf {
  return (stream) =>
    Effect.runPromise(
      Effect.flatMap(firstStartIn(ledger, stream), (first) =>
        first === undefined
          ? Effect.undefined
          : Effect.map(decodeStartedIn(first.data), ({ playbook }) => ({ version: first.version, playbook })),
      ),
    );
}
