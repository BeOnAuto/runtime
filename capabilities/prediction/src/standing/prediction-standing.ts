import type { Standing } from '@on.auto/definitions';
import { cursorOfParts, type PlaybookAddress, type ProjectionReader } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import type { DatasetRow } from '../dataset/dataset-rows.ts';
import type { DatasetsPort } from '../dataset/datasets-port.ts';
import { modelStandingOf } from './model-standing.ts';

const DetailsSchema = Schema.Struct({
  data_sha256: Schema.String,
  data: Schema.Struct({ dataset: Schema.optionalKey(Schema.String) }),
});

const decodeDetails = Schema.decodeUnknownOption(DetailsSchema);

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

function datasetPart(
  datasets: DatasetsPort,
  playbook: PlaybookAddress,
  dataSha256: string,
  dataset: string | undefined,
) {
  return dataset === undefined
    ? Effect.map(datasets.datasetOf(playbook, dataSha256), (row) => datasetStanding(dataSha256, row))
    : Effect.succeed({ kind: 'uploaded', sha256: dataset });
}

export function predictionStanding(
  datasets: DatasetsPort,
  ledger: Pick<ProjectionReader, 'readProjectedRows'>,
): Standing {
  return ({ org, playbook, name, status, details }) =>
    Option.match(status === 'retired' ? Option.none() : decodeDetails(details), {
      onNone: () => Effect.undefined,
      onSome: ({ data_sha256: dataSha256, data }) =>
        Effect.zipWith(
          datasetPart(datasets, { org, playbook }, dataSha256, data.dataset),
          modelStandingOf(ledger, { org, playbook }, name),
          (dataset, { models, build }) => ({ dataset, models, build }),
        ),
    });
}
