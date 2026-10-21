import { Effect, Redacted } from 'effect';

import { KeeperUnavailable } from '../keepers/keeper-unavailable.ts';
import type { Keeper } from '../keepers/keeper.ts';
import type { Holding } from '../rows/secret-rows.ts';

export interface MemoryKeeper extends Keeper {
  readonly valueOf: (holding: Holding) => string | undefined;
  readonly lose: (holding: Holding) => void;
  readonly released: () => readonly Holding[];
  readonly refuse: () => void;
  readonly answer: () => void;
}

export interface TestKeepers {
  readonly aKeeper: () => Promise<Keeper>;
  readonly valueIn: (holding: Holding) => Promise<string | undefined>;
  readonly lose: (holding: Holding) => Promise<void>;
}

export const memoryKeeperRefusal = 'The keeper in memory is told to refuse';

interface Version {
  readonly id: string;
  readonly version: number;
}

function versionOf({ held }: Holding): Version {
  const separator = held.lastIndexOf(':');
  return { id: held.slice(0, separator), version: Number(held.slice(separator + 1)) };
}

export function memoryKeeper(name = 'memory'): MemoryKeeper {
  const values = new Map<string, readonly string[]>();
  const released: Holding[] = [];
  const now = { refusing: false };
  const answered = <A>(answer: () => A): Effect.Effect<A, KeeperUnavailable> =>
    Effect.suspend(() =>
      now.refusing ? Effect.fail(new KeeperUnavailable({ detail: memoryKeeperRefusal })) : Effect.sync(answer),
    );
  const valueOf = (holding: Holding): string | undefined => {
    const { id, version } = versionOf(holding);
    return values.get(id)?.[version - 1];
  };
  return {
    name,
    hold: (id, value) =>
      answered(() => {
        const versions = [...(values.get(id) ?? []), Redacted.value(value)];
        values.set(id, versions);
        return { keptBy: name, held: `${id}:${versions.length}` };
      }),
    reveal: (holding) =>
      answered(() => {
        const value = valueOf(holding);
        return value === undefined ? undefined : Redacted.make(value);
      }),
    release: (holding) =>
      answered(() => {
        values.delete(versionOf(holding).id);
        released.push(holding);
      }),
    valueOf,
    lose: (holding) => {
      values.delete(versionOf(holding).id);
    },
    released: () => [...released],
    refuse: () => {
      now.refusing = true;
    },
    answer: () => {
      now.refusing = false;
    },
  };
}

export function inMemoryKeepers(): TestKeepers {
  const keeper = memoryKeeper();
  return {
    aKeeper: () => Promise.resolve(keeper),
    valueIn: (holding) => Promise.resolve(keeper.valueOf(holding)),
    lose: (holding) => {
      keeper.lose(holding);
      return Promise.resolve();
    },
  };
}
