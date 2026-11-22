import { Effect } from 'effect';

/**
 * The work a server has in hand that its host's fibers do not count: a request it has not answered, a statement of its
 * ledger not done. A host whose every fiber sleeps is not at rest while any is in hand, since what it does next may wake
 * the host or change what a test reads.
 */
export interface WorkInHand {
  /** Says work began; the function returned says it ended. */
  readonly begun: () => () => void;
  readonly busy: () => boolean;
  /** Answers once nothing is in hand, asked while something is. */
  readonly done: () => Promise<void>;
}

export function workInHand(): WorkInHand {
  const counts = { inHand: 0 };
  const waiting: (() => void)[] = [];
  return {
    begun: () => {
      counts.inHand += 1;
      return () => {
        counts.inHand -= 1;
        for (const done of counts.inHand === 0 ? waiting.splice(0) : []) {
          done();
        }
      };
    },
    busy: () => counts.inHand > 0,
    done: () =>
      new Promise<void>((resolve) => {
        waiting.push(resolve);
      }),
  };
}

/** The effect, in hand from the moment it runs until it ends, however it ends. */
function whileInHand<A, E, R>(inHand: WorkInHand, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(inHand.begun),
    () => effect,
    (ended) => Effect.sync(ended),
  );
}

/** The ports given, each effect one of them answers in hand while it runs: a ledger's statements, say. */
export function statementsInHand<Ports extends object>(inHand: WorkInHand, ports: Ports): Ports {
  return new Proxy(ports, {
    get: (target, name) => {
      const port: unknown = Reflect.get(target, name);
      return typeof port === 'function'
        ? (...given: readonly unknown[]) => {
            const answer: unknown = Reflect.apply(port, target, given);
            return Effect.isEffect(answer) ? whileInHand(inHand, answer) : answer;
          }
        : port;
    },
  });
}
