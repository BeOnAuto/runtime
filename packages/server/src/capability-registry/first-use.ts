import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import { Duration, Effect, Exit, Layer, LayerRef, Scope } from 'effect';

import { inRuntime } from '../workflows/in-runtime.ts';

export interface ScopeOfTheRuntime {
  readonly closedFirstOf: <R>(services: Layer.Layer<R>) => Layer.Layer<R>;
  readonly openedIn: <A>(
    runtime: AppRuntime<DispatcherServices>,
    opening: Effect.Effect<A, never, Scope.Scope>,
  ) => Promise<A>;
}

export function composedOnFirstUse<I, A, E>(
  service: Effect.Effect<A, never, I>,
  layer: Layer.Layer<I, E>,
): Effect.Effect<Effect.Effect<A, E>, never, Scope.Scope> {
  return Effect.map(LayerRef.make(layer, { idleTimeToLive: Duration.infinity, preload: false }), (composed) =>
    Effect.provide(service, composed.get),
  );
}

export function scopeOfTheRuntime(): ScopeOfTheRuntime {
  const scope = Scope.makeUnsafe();
  const closing = Layer.effectDiscard(Effect.addFinalizer(() => Scope.close(scope, Exit.void)));
  return {
    closedFirstOf: (services) => Layer.provideMerge(closing, services),
    openedIn: (runtime, opening) => Effect.runPromise(inRuntime(runtime, Scope.provide(opening, scope))),
  };
}
