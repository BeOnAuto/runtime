export interface BoundedCache<V> {
  readonly get: (key: string) => V | undefined;
  readonly set: (key: string, value: V) => void;
  readonly characters: () => number;
}

export function boundedCacheOf<V>(mostCharacters: number): BoundedCache<V> {
  const entries = new Map<string, V>();
  const held = { characters: 0 };
  const forget = (key: string): void => {
    if (entries.delete(key)) {
      held.characters -= key.length;
    }
  };
  const forgetOldestUntilFits = (): void => {
    for (const key of entries.keys()) {
      if (held.characters <= mostCharacters) {
        return;
      }
      forget(key);
    }
  };
  return {
    get: (key) => {
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set: (key, value) => {
      forget(key);
      if (key.length > mostCharacters) {
        return;
      }
      entries.set(key, value);
      held.characters += key.length;
      forgetOldestUntilFits();
    },
    characters: () => held.characters,
  };
}
