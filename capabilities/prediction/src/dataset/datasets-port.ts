import { streamPrefixOfPlaybook, type PlaybookAddress } from '@on.auto/operations';
import { rowsOf, type HostDatabase } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { datasetRowOf, StoredDatasetSchema, type DatasetRow } from './dataset-rows.ts';
import { datasetNamed } from './dataset-statements.ts';

export interface DatasetsPort {
  readonly datasetOf: (playbook: PlaybookAddress, dataSha256: string) => Effect.Effect<DatasetRow | undefined>;
}

export function datasetsPortOn(database: Pick<HostDatabase, 'read'>): DatasetsPort {
  return {
    datasetOf: (playbook, dataSha256) =>
      rowsOf(StoredDatasetSchema, database.read(datasetNamed(streamPrefixOfPlaybook(playbook), dataSha256))).pipe(
        Effect.map(([row]) => (row === undefined ? undefined : datasetRowOf(row))),
        Effect.orDie,
      ),
  };
}
