import type { PlaybookAddress, ProjectedKeyedRow, ProjectionReader } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { buildRowFrom, predictionBuildsName } from '../builds/build-rows.ts';
import { modelsRowOf, predictionModelsName, type ModelsRow } from '../models/models-projection.ts';

function modelsStanding(row: ModelsRow): Schema.JsonObject {
  return {
    active: row.active === null ? null : { version: row.active, data_sha256: row.active_data_sha256 },
    latest: row.latest,
    versions: row.versions,
    challenger:
      row.challenger === null
        ? null
        : {
            version: row.challenger,
            build: row.challenger_build,
            shadow: { predicted: row.shadow_predicted, graded: row.shadow_graded, result: row.shadow },
          },
  };
}

function buildStanding({ key, row: stored }: ProjectedKeyedRow): Schema.JsonObject {
  const row = buildRowFrom(stored);
  return {
    run_id: key,
    standing: row.standing,
    requested_at: new Date(row.requested_at).toISOString(),
    expires_at: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
    candidates: row.uploaded,
    scored: row.scored,
  };
}

export interface ModelStanding {
  readonly models: Schema.JsonObject;
  readonly build: Schema.JsonObject | null;
}

export function modelStandingOf(
  ledger: Pick<ProjectionReader, 'readProjectedRows'>,
  playbook: PlaybookAddress,
  name: string,
): Effect.Effect<ModelStanding> {
  return Effect.zipWith(
    ledger.readProjectedRows(predictionModelsName, playbook, {
      where: [{ column: 'row_key', equals: name }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ledger.readProjectedRows(predictionBuildsName, playbook, {
      where: [
        { column: 'function', equals: name },
        { column: 'open', equals: true },
      ],
      orderBy: ['requested_at'],
      order: 'desc',
      limit: 1,
    }),
    ([models], [build]) => ({
      models: modelsStanding(modelsRowOf(models?.row)),
      build: build === undefined ? null : buildStanding(build),
    }),
  );
}
