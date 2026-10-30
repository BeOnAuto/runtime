import type { Cancelled } from '@on.auto/operations';
import { Cause, Exit, ManagedRuntime, type Context, type Effect, type Layer } from 'effect';

export interface AppRuntime<R> {
  readonly run: <A>(effect: Effect.Effect<A, never, R>, signal?: AbortSignal) => Promise<A | Cancelled>;
  readonly dispose: () => Promise<void>;
  readonly context: Context.Context<never>;
}

const cancelled: Cancelled = { status: 'cancelled' };

export async function makeAppRuntime<R, E>(layer: Layer.Layer<R, E>): Promise<AppRuntime<R>> {
  const runtime = ManagedRuntime.make(layer);
  const context = await runtime.context();
  let disposed = false;
  return {
    run: async (effect, signal) => {
      if (disposed) {
        return cancelled;
      }
      const exit = await runtime.runPromiseExit(effect, { signal });
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      if (Cause.hasInterruptsOnly(exit.cause)) {
        return cancelled;
      }
      throw new Error(Cause.pretty(exit.cause));
    },
    dispose: async () => {
      disposed = true;
      await runtime.dispose();
    },
    context,
  };
}
