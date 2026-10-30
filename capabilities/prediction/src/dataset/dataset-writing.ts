import {
  chunksWithin,
  pointText,
  rowsOf,
  statement,
  type DatabaseFailed,
  type Statement,
  type StatementValue,
  type Writing,
} from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { periodForm } from '../periods/grains.ts';
import type { DatasetChange } from './dataset-fold.ts';
import type { MergedRow } from './dataset-merging.ts';
import type { DatasetRow } from './dataset-rows.ts';
import { composed, tuples } from './dataset-statements.ts';

const WrittenSchema = Schema.Struct({ data_sha256: Schema.String });

const valuesOfARow = 9;

function upsertOf(values: readonly (readonly StatementValue[])[]): Statement {
  return composed(
    'INSERT INTO prediction_rows (playbook_key, data_sha256, series, period_index, period, target, target_count, target_at, events) VALUES ',
    ...tuples(values),
    ' ON CONFLICT (playbook_key, data_sha256, series, period_index) DO UPDATE SET target = excluded.target,',
    ' target_count = excluded.target_count, target_at = excluded.target_at, events = excluded.events',
  );
}

function upserted(row: DatasetRow, upserts: readonly MergedRow[], mostBoundValues: number): readonly Statement[] {
  const values = upserts.map(({ series, period, target, events }): readonly StatementValue[] => [
    row.playbookKey,
    row.dataSha256,
    series,
    period,
    periodForm(row.data.period, period),
    target.value,
    target.count,
    target.at,
    events,
  ]);
  return chunksWithin(values, { mostBoundValues, valuesEach: valuesOfARow }).map((chunk) => upsertOf(chunk));
}

function moved({ row, next }: DatasetChange): Statement {
  return statement`UPDATE prediction_datasets SET phase = ${next.phase}, checkpoint = ${pointText(next.checkpoint)},
      checkpoint_at = ${next.checkpointAt}, rows = ${next.rows}, series = ${next.series},
      first_period = ${next.firstPeriod}, last_period = ${next.lastPeriod}, events_folded = ${next.eventsFolded},
      passed_over = ${next.passedOver}, tries = ${next.tries}, stalled_record = ${next.stall?.record ?? null},
      stalled_detail = ${next.stall?.detail ?? null}
    WHERE playbook_key = ${row.playbookKey} AND data_sha256 = ${row.dataSha256} AND checkpoint = ${row.checkpointText}
    RETURNING data_sha256`;
}

function datasetNamedBy(dataSha256: string): string {
  return `the dataset ${dataSha256.slice(0, 12)}`;
}

function passedOverNoted({ note, playbook }: Writing, { row, passedOver }: DatasetChange): Effect.Effect<void> {
  return Effect.forEach(
    passedOver.slice(0, predictionBounds.mostNotesAPage),
    ({ record, detail }) =>
      note({
        kind: 'record_passed_over',
        playbook,
        record,
        reason: 'refused',
        by: datasetNamedBy(row.dataSha256),
        detail,
      }),
    { discard: true },
  );
}

function stallNoted({ note, playbook }: Writing, { row, next }: DatasetChange): Effect.Effect<void> {
  return next.stall === null
    ? Effect.void
    : note({ kind: 'dataset_stalled', playbook, dataSha256: row.dataSha256, ...next.stall });
}

export function datasetWritten(
  writing: Writing,
  change: DatasetChange,
): Effect.Effect<DatasetRow | undefined, DatabaseFailed> {
  const { row, next, upserts } = change;
  const { database } = writing;
  const written = database.transaction([...upserted(row, upserts, database.mostBoundValues), moved(change)]);
  return Effect.flatMap(rowsOf(WrittenSchema, written), (took) =>
    took.length === 0
      ? Effect.undefined
      : Effect.as(Effect.andThen(passedOverNoted(writing, change), stallNoted(writing, change)), {
          ...row,
          ...next,
          checkpointText: pointText(next.checkpoint),
        }),
  );
}
