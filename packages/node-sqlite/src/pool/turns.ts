interface Turns {
  readonly taken: <A>(work: () => Promise<A>) => Promise<A>;
}

export function turnsOf(most: number): Turns {
  const waiting: (() => void)[] = [];
  const state = { held: 0 };
  const released = () => {
    const next = waiting.shift();
    if (next === undefined) {
      state.held -= 1;
    } else {
      next();
    }
  };
  const turn = () =>
    state.held < most
      ? Promise.resolve(void (state.held += 1))
      : new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
  return {
    taken: async (work) => {
      await turn();
      try {
        return await work();
      } finally {
        released();
      }
    },
  };
}
