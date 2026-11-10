import { settle } from '@on.auto/operations';
import { Effect, Logger, type Schema } from 'effect';

import { acmeAdmin } from './callers.ts';
import { quietMs } from './capabilities/resumer.ts';
import { toPlaybook } from './harness.ts';
import { watchedStore } from './kept-payloads.ts';
import { leftWithItsInputKept } from './kept-resumed-runs.ts';
import { acted, momentAfter } from './resumed-runs.ts';
import { drivingAShell } from './shell-drives.ts';

export async function drivenWithItsInputKept(input: Schema.Json, held: boolean) {
  const watched = watchedStore();
  const started = await leftWithItsInputKept({ input, held, store: watched.store });
  const drive = drivingAShell([started.resuming.capability], started.resuming.capability);
  const request = toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: acted.runId });
  const at = momentAfter(quietMs + 1);
  const driven = () => started.call(drive, request, at);
  const drivenCancelledWhenLogged = async () => {
    const logged: string[] = [];
    const cancelling = new AbortController();
    const cancelledOnTheFirstLine = Logger.layer([
      Logger.make(({ message }: { readonly message: unknown }) => {
        logged.push(String(message));
        cancelling.abort();
      }),
    ]);
    const call = started.dispatch(drive, request).pipe(Effect.provide(cancelledOnTheFirstLine));
    const settled = await started.run(settle(call, cancelling.signal), at);
    return { settled, logged };
  };
  return { ...started, watched, driven, drivenCancelledWhenLogged };
}
