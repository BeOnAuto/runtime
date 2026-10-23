import { Duration, Effect, LayerRef, type Layer, type Scope } from 'effect';

export function composedOnFirstUse<I, A, E>(
  service: Effect.Effect<A, never, I>,
  layer: Layer.Layer<I, E>,
): Effect.Effect<Effect.Effect<A, E>, never, Scope.Scope> {
  return Effect.map(LayerRef.make(layer, { idleTimeToLive: Duration.infinity, preload: false }), (composed) =>
    Effect.provide(service, composed.get),
  );
}
