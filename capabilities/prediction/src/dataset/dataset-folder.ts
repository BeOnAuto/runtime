import type { FilterSandbox } from '@on.auto/workflow-engine';
import {
  rowsOf,
  someFolder,
  type CapabilityPorts,
  type DatabaseFailed,
  type Folder,
  type HostDatabase,
  type KeptFunction,
  type ProvidedCapability,
  type Reconciled,
  type Reconciling,
  type RowPhase,
} from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import { predictionBounds, predictionDefinitionType } from '../capability/prediction-bounds.ts';
import { canonicalJson } from '../data/data-digest.ts';
import { datasetOfKept, keptDatasetOf } from './dataset-data.ts';
import { foldedDatasets, hasDatasetChanged, type DatasetChange } from './dataset-fold.ts';
import { datasetRowOf, standingOf, StoredDatasetSchema, type DatasetRow } from './dataset-rows.ts';
import {
  datasetAdded,
  datasetDropped,
  datasetPhased,
  datasetsOfPlaybook,
  datasetsTable,
  playbooksWithDatasets,
  rowsTable,
} from './dataset-statements.ts';
import { datasetWritten } from './dataset-writing.ts';

export interface DatasetFolding {
  readonly filters: FilterSandbox;
  readonly triesBeforeStall: number;
  readonly rebuildsAtOnce?: number;
}

interface Wanted {
  readonly saved: number;
  readonly data: string;
}

const PlaybookSchema = Schema.Struct({ playbook_key: Schema.String });

function wantedOf(functions: ReadonlyMap<string, KeptFunction>): ReadonlyMap<string, Wanted> {
  const wanted = new Map<string, Wanted>();
  for (const { details, saved } of functions.values()) {
    const kept = datasetOfKept(details);
    if (kept !== undefined) {
      const earlier = wanted.get(kept.dataSha256);
      const data = canonicalJson(kept.data);
      wanted.set(kept.dataSha256, { saved: Math.min(saved, earlier?.saved ?? saved), data });
    }
  }
  return wanted;
}

function plannedDatasets({ playbook, definitions }: Reconciling, rows: readonly DatasetRow[]): Reconciled<DatasetRow> {
  const wanted = wantedOf(definitions.functions);
  const known = new Set(rows.map(({ dataSha256 }) => dataSha256));
  return {
    fresh: [...wanted]
      .filter(([dataSha256]: readonly [string, Wanted]) => !known.has(dataSha256))
      .map(([dataSha256, { saved, data }]: readonly [string, Wanted]) => ({
        key: dataSha256,
        saved,
        added: datasetAdded(playbook, dataSha256, saved, data),
      })),
    dropped: rows.filter(({ dataSha256 }) => !wanted.has(dataSha256)),
  };
}

export function datasetsOf(
  database: HostDatabase,
  playbook: string,
): Effect.Effect<readonly DatasetRow[], DatabaseFailed> {
  return Effect.map(rowsOf(StoredDatasetSchema, database.read(datasetsOfPlaybook(playbook))), (rows) =>
    rows.map((row) => datasetRowOf(row)),
  );
}

export function datasetFolder({
  filters,
  triesBeforeStall,
  rebuildsAtOnce = predictionBounds.datasetRebuildsAtOnce,
}: DatasetFolding): Folder<DatasetRow, DatasetChange> {
  return {
    definitionType: predictionDefinitionType,
    tables: [datasetsTable, rowsTable],
    rebuildsAtOnce,
    keptOf: keptDatasetOf,
    keyOf: ({ dataSha256 }) => dataSha256,
    typesOf: ({ data }) => data.events.map(({ type }) => type),
    playbooksWithRows: (database) =>
      Effect.map(rowsOf(PlaybookSchema, database.read(playbooksWithDatasets)), (rows) =>
        rows.map(({ playbook_key: playbookKey }) => playbookKey),
      ),
    rowsOf: datasetsOf,
    reconcile: plannedDatasets,
    dropped: ({ playbookKey, dataSha256 }) => datasetDropped(playbookKey, dataSha256),
    phased: ({ playbookKey, dataSha256 }, phase: RowPhase) => datasetPhased(playbookKey, dataSha256, phase),
    fold: (rows, page, database) => foldedDatasets(rows, page, database, { sandbox: filters, triesBeforeStall }),
    write: datasetWritten,
    unchanged: (row) => ({ row, next: standingOf(row), upserts: [], passedOver: [] }),
    joinedLive: (change) => ({ ...change, next: { ...change.next, phase: 'live' } }),
    hasChanged: hasDatasetChanged,
  };
}

export function datasetsProvidedOn({
  pool,
  triesBeforeStall,
}: Pick<CapabilityPorts, 'pool' | 'triesBeforeStall'>): Required<Pick<ProvidedCapability, 'folders'>> {
  return {
    folders: [someFolder(datasetFolder({ filters: pool.evaluations.filters, triesBeforeStall }))],
  };
}
