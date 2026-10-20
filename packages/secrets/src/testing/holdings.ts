import type { Holding } from '../rows/secret-rows.ts';

export function sealedHolding(name: string, kid = 'kid-a'): Holding {
  return { keptBy: 'ledger', held: `held-${name}`, wrappedKey: `wrapped-${name}`, kid };
}

export function rewrapped(name: string, kid: string): Holding {
  return { ...sealedHolding(name), wrappedKey: `rewrapped-${name}`, kid };
}

export const heldElsewhere: Holding = { keptBy: 'another-keeper', held: 'secret-4:1' };
