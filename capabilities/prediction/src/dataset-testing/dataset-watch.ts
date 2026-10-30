import type { HostDatabase } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { expect, vi } from 'vitest';

import { datasetsOf } from '../dataset/dataset-folder.ts';
import type { DatasetRow } from '../dataset/dataset-rows.ts';
import { playbooksWithDatasets } from '../dataset/dataset-statements.ts';
import type { Holds } from './dataset-predicates.ts';
import { alphaKey } from './projected-datasets.ts';

export interface DatasetWatch {
  readonly through: (database: HostDatabase) => HostDatabase;
  readonly phasesOf: (dataSha256: string) => readonly string[];
  readonly until: (dataSha256: string, holds: Holds) => Promise<void>;
  readonly sweeps: () => number;
  readonly untilSwept: (sweeps: number) => Promise<void>;
}

const waiting = { timeout: 25_000, interval: 20 };

export function watchingDatasets(): DatasetWatch {
  const seen: (readonly DatasetRow[])[] = [];
  const swept = { sweeps: 0 };
  const rowsOf = (dataSha256: string) => seen.flatMap((rows) => rows.filter((row) => row.dataSha256 === dataSha256));
  return {
    through: (database) => {
      const read = Effect.map(datasetsOf(database, alphaKey), (rows) => {
        seen.push(rows);
      });
      return {
        ...database,
        read: (statement) => {
          swept.sweeps += statement === playbooksWithDatasets ? 1 : 0;
          return database.read(statement);
        },
        write: (statement) => Effect.tap(database.write(statement), () => read),
        transaction: (statements) => Effect.tap(database.transaction(statements), () => read),
      };
    },
    phasesOf: (dataSha256) => [...new Set(rowsOf(dataSha256).map(({ phase }) => phase))],
    until: (dataSha256, holds) =>
      vi.waitFor(() => {
        expect(rowsOf(dataSha256).some((row) => holds(row))).toBe(true);
      }, waiting),
    sweeps: () => swept.sweeps,
    untilSwept: (sweeps) =>
      vi.waitFor(() => {
        expect(swept.sweeps).toBeGreaterThanOrEqual(sweeps);
      }, waiting),
  };
}
