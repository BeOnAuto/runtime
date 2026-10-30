import { Effect } from 'effect';

import type { SeriesRows } from '../files/series-rows.ts';

export interface ParsedRows {
  readonly rowsOf: (
    sha256: string,
    parse: () => Promise<readonly SeriesRows[]>,
  ) => Effect.Effect<readonly SeriesRows[]>;
  readonly released: (sha256: string) => Effect.Effect<void>;
}

export function parsedRows(most: number): ParsedRows {
  const kept = new Map<string, Promise<readonly SeriesRows[]>>();
  const parsedOf = (sha256: string, parse: () => Promise<readonly SeriesRows[]>) => {
    const known = kept.get(sha256);
    const parsing = known ?? parse();
    kept.delete(sha256);
    kept.set(sha256, parsing);
    for (const sha256Kept of [...kept.keys()].slice(0, Math.max(0, kept.size - most))) {
      kept.delete(sha256Kept);
    }
    parsing.catch(() => kept.delete(sha256));
    return parsing;
  };
  return {
    rowsOf: (sha256, parse) => Effect.promise(() => parsedOf(sha256, parse)),
    released: (sha256) =>
      Effect.sync(() => {
        kept.delete(sha256);
      }),
  };
}
