import type { Standing } from '@on.auto/definitions';
import { cursorOfParts } from '@on.auto/operations';
import { Effect, Option, type Schema } from 'effect';

import { keptDatasetOf } from '../dataset/dataset-data.ts';
import type { DatasetRow } from '../dataset/dataset-rows.ts';
import type { DatasetsPort } from '../dataset/datasets-port.ts';

function datasetStanding(dataSha256: string, row: DatasetRow | undefined): Schema.JsonObject {
  if (row === undefined) {
    return {
      kind: 'projection',
      data_sha256: dataSha256,
      phase: 'waiting',
      checkpoint: null,
      checkpoint_at: null,
      rows: 0,
      series: 0,
      first_period: null,
      last_period: null,
      events_folded: 0,
      passed_over: 0,
      stall: null,
    };
  }
  return {
    kind: 'projection',
    data_sha256: dataSha256,
    phase: row.phase,
    checkpoint: row.checkpoint === undefined ? null : cursorOfParts([row.playbookKey, ...row.checkpoint]),
    checkpoint_at: row.checkpointAt,
    rows: row.rows,
    series: row.series,
    first_period: row.firstPeriod,
    last_period: row.lastPeriod,
    events_folded: row.eventsFolded,
    passed_over: row.passedOver,
    stall: row.stall === null ? null : { record: row.stall.record, detail: row.stall.detail },
  };
}

export function predictionStanding(datasets: DatasetsPort): Standing {
  return ({ org, playbook, status, details }) =>
    Option.match(status === 'retired' ? Option.none() : Option.fromNullishOr(keptDatasetOf(details)), {
      onNone: () => Effect.undefined,
      onSome: ({ dataSha256 }) =>
        Effect.map(datasets.datasetOf({ org, playbook }, dataSha256), (row) => ({
          dataset: datasetStanding(dataSha256, row),
        })),
    });
}
