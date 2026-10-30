import { Effect, type Context } from 'effect';

function connectionLost(error: Readonly<Error>): Effect.Effect<void> {
  return Effect.logWarning(
    'A connection to the PostgreSQL database of the ledger was lost; the ledger opens another when it needs one',
  ).pipe(Effect.annotateLogs({ error: error.message }));
}

export function lostConnectionsLoggedWith(context: Context.Context<never>): (error: Readonly<Error>) => void {
  return (error) => {
    Effect.runForkWith(context)(connectionLost(error));
  };
}
