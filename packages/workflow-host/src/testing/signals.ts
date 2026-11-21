interface Waiter {
  readonly check: () => boolean;
}

export interface Signals {
  readonly changed: () => void;
  readonly when: <A>(read: () => A, holds: (value: A) => boolean) => Promise<A>;
}

export function signals(): Signals {
  const waiters = new Set<Waiter>();
  return {
    changed: () => {
      for (const waiter of waiters) {
        if (waiter.check()) {
          waiters.delete(waiter);
        }
      }
    },
    when: (read, holds) => {
      const { promise, resolve } = Promise.withResolvers<ReturnType<typeof read>>();
      const waiter: Waiter = {
        check: () => {
          const value = read();
          if (!holds(value)) {
            return false;
          }
          resolve(value);
          return true;
        },
      };
      if (!waiter.check()) {
        waiters.add(waiter);
      }
      return promise;
    },
  };
}
