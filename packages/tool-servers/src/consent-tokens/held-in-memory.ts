export interface HeldInMemory<A> {
  readonly held: () => A | undefined;
  readonly hold: (value: A) => void;
  readonly forget: () => void;
}

export function heldInMemory<A>(): HeldInMemory<A> {
  const memory: { value?: A } = {};
  return {
    held: () => memory.value,
    hold: (value) => {
      memory.value = value;
    },
    forget: () => {
      delete memory.value;
    },
  };
}
