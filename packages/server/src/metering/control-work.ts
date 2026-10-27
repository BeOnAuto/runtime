export function controlledWork() {
  const pending = new Set<Promise<unknown>>();
  let stopped = false;
  return {
    run: async <A>(perform: () => Promise<A>): Promise<A> => {
      if (stopped) throw new Error('runtime_meter_stopping');
      const work = Promise.resolve().then(perform);
      pending.add(work);
      try {
        return await work;
      } finally {
        pending.delete(work);
      }
    },
    stop: async () => {
      stopped = true;
      await Promise.allSettled(pending);
    },
  };
}
