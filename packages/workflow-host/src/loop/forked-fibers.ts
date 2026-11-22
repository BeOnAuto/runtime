import { Context, Effect, type Fiber } from 'effect';

export type HostContext = Context.Context<never> | undefined;

/** A fiber the host forked, by the name a test gives when it says which of them still work. */
export interface ForkedFiber {
  readonly label: string;
}

export interface FiberWatch {
  /** Told of each fiber the host forks, with a way to be told once that fiber ends, and the fiber by its name. */
  readonly forked: (whenEnded: (ended: () => void) => void, fiber: ForkedFiber) => void;
}

/**
 * Told each fiber the host forks, and nothing by default. A test stepping the host's clock gives one in the host's
 * context, so it knows the host is wholly at rest once every fiber the host forked that still lives sleeps on it.
 */
export const ForkWatch = Context.Reference<FiberWatch>('@on.auto/workflow-host/ForkWatch', {
  defaultValue: () => ({ forked: () => {} }),
});

/** The fiber the host forked that work runs in, the fibers it forks in turn included; none outside such a fiber. */
export const InForkedFiber = Context.Reference<ForkedFiber | undefined>('@on.auto/workflow-host/InForkedFiber', {
  defaultValue: () => {},
});

export function forkedIn<A, E>(context: HostContext, work: Effect.Effect<A, E>, label: string): Fiber.Fiber<A, E> {
  const given = context ?? Context.empty();
  const named: ForkedFiber = { label };
  const fiber = Effect.runForkWith(Context.add(given, InForkedFiber, named))(work);
  Context.get(given, ForkWatch).forked((ended) => {
    fiber.addObserver(ended);
  }, named);
  return fiber;
}

export function ranIn<A, E>(context: HostContext, work: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromiseWith(context ?? Context.empty())(work);
}
