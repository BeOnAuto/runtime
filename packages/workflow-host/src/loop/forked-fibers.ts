import { Context, Effect, type Fiber } from 'effect';

export type HostContext = Context.Context<never> | undefined;

export function forkedIn<A, E>(context: HostContext, work: Effect.Effect<A, E>): Fiber.Fiber<A, E> {
  return Effect.runForkWith(context ?? Context.empty())(work);
}

export function ranIn<A, E>(context: HostContext, work: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromiseWith(context ?? Context.empty())(work);
}
