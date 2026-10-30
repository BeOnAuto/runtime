import { Conflict, type Context, type Decided, type Decider, type Recorded } from '@on.auto/operations';
import { Result, type Schema } from 'effect';

export type OwnCallTurn<Event extends Recorded> = 'none' | Event['type'];

export interface OwnCall<Event extends Recorded> {
  readonly event: Decided<Event>;
  readonly context: Context;
}

export interface OwnCallTurns<Event extends Recorded> {
  readonly first: readonly Event['type'][];
  readonly after: Readonly<Partial<Record<Event['type'], readonly Event['type'][]>>>;
  readonly eventSchema: Schema.ConstraintCodec<Event, unknown>;
  readonly outOfTurn: string;
}

export function ownCallDecider<Event extends Recorded>({
  first,
  after,
  eventSchema,
  outOfTurn,
}: OwnCallTurns<Event>): Decider<OwnCallTurn<Event>, OwnCall<Event>, Event, 'conflict'> {
  const refused = new Conflict({ detail: outOfTurn });
  const takes = (state: OwnCallTurn<Event>, type: Event['type']): boolean =>
    state === 'none' ? first.includes(type) : (after[state] ?? []).includes(type);
  return {
    initialState: 'none',
    evolve: (_state, { type }) => type,
    decide: ({ event }, state) => (takes(state, event.type) ? Result.succeed([event]) : Result.fail(refused)),
    context: ({ context }) => context,
    eventSchema,
  };
}
