export interface Table<A> {
  readonly rows: () => readonly A[];
  readonly found: (key: string) => A | undefined;
  readonly put: (key: string, row: A) => void;
  readonly deleted: (isDeleted: (row: A) => boolean) => boolean;
}

export function tableOf<A>(): Table<A> {
  const rows = new Map<string, A>();
  return {
    rows: () => [...rows.values()],
    found: (key) => rows.get(key),
    put: (key, row) => {
      rows.set(key, row);
    },
    deleted: (isDeleted) => {
      const deleted = [...rows].filter(([, row]: readonly [string, A]) => isDeleted(row));
      for (const [key] of deleted) {
        rows.delete(key);
      }
      return deleted.length > 0;
    },
  };
}

export const keyOf = (...parts: readonly string[]): string => JSON.stringify(parts);
