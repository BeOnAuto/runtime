import { Effect, type Context } from 'effect';

export const lostConnectionLogged =
  'A connection to the PostgreSQL database of the ledger was lost; the ledger opens another when it needs one';

function connectionLost(error: Readonly<Error>): Effect.Effect<void> {
  return Effect.logWarning(lostConnectionLogged).pipe(Effect.annotateLogs({ error: error.message }));
}

export function lostConnectionsLoggedWith(context: Context.Context<never>): (error: Readonly<Error>) => void {
  return (error) => {
    Effect.runForkWith(context)(connectionLost(error));
  };
}
