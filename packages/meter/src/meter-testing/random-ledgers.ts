export type Random = () => number;

const MODULUS = 2_147_483_647;

export function seeded(seed: number): Random {
  const state = { value: seed };
  const next = () => {
    state.value = (state.value * 48_271) % MODULUS;
    return (state.value - 1) / (MODULUS - 1);
  };
  Array.from({ length: 12 }, next);
  return next;
}

export function pickOf(random: Random): <Item>(first: Item, ...rest: readonly Item[]) => Item {
  return (first, ...rest) => {
    const chosen = Math.floor(random() * (rest.length + 1));
    return rest.reduce((kept, item, place) => (place + 1 === chosen ? item : kept), first);
  };
}
