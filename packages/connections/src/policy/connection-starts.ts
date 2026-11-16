import { Forbidden, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

export type ConnectionStart = 'anyone' | 'may take over' | { readonly refused: string };

export type ConnectionStarts = (provider: string) => Effect.Effect<ConnectionStart, Unavailable>;

export interface StartsOfConnections {
  readonly starts?: ConnectionStarts | undefined;
}

const startedByAnyone: ConnectionStarts = () => Effect.succeed('anyone');

export function startOf(
  { starts = startedByAnyone }: StartsOfConnections,
  provider: string,
): Effect.Effect<ConnectionStart, Unavailable> {
  return starts(provider);
}

export function admittedStartOf(
  services: StartsOfConnections,
  provider: string,
): Effect.Effect<'anyone' | 'may take over', Unavailable | Forbidden> {
  return Effect.flatMap(startOf(services, provider), (start) =>
    typeof start === 'string' ? Effect.succeed(start) : Effect.fail(new Forbidden({ detail: start.refused })),
  );
}
