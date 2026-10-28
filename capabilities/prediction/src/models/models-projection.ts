import {
  strictRecordedDecoder,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
} from '@on.auto/operations';
import { Schema } from 'effect';

import {
  modelsStreamKind,
  VersionFactSchema,
  versionFactTypes,
  type RecordedVersionFact,
} from '../facts/model-facts.ts';

export const predictionModelsName = 'prediction_models';

const ModelsRowSchema = Schema.Struct({
  active: Schema.NullOr(Schema.Int),
  active_data_sha256: Schema.NullOr(Schema.String),
  active_file_sha256: Schema.NullOr(Schema.String),
  active_file_format: Schema.NullOr(Schema.String),
  active_definition_version: Schema.NullOr(Schema.Int),
  latest: Schema.NullOr(Schema.Int),
  versions: Schema.Int,
  challenger: Schema.NullOr(Schema.Int),
  challenger_build: Schema.NullOr(Schema.String),
  shadow_predicted: Schema.Int,
  shadow_graded: Schema.Int,
  shadow: Schema.NullOr(Schema.Literals(['passed', 'failed'])),
});

export type ModelsRow = typeof ModelsRowSchema.Type;

const noModelsRow: ModelsRow = {
  active: null,
  active_data_sha256: null,
  active_file_sha256: null,
  active_file_format: null,
  active_definition_version: null,
  latest: null,
  versions: 0,
  challenger: null,
  challenger_build: null,
  shadow_predicted: 0,
  shadow_graded: 0,
  shadow: null,
};

const decodeRow = Schema.decodeUnknownSync(ModelsRowSchema);

export function modelsRowOf(row: ProjectedRow | undefined): ModelsRow {
  return row === undefined ? noModelsRow : decodeRow(row);
}

function withoutChallenger(row: ModelsRow, version: number): ModelsRow {
  return row.challenger === version ? { ...row, challenger: null, challenger_build: null } : row;
}

function ofTheChallenger(row: ModelsRow, version: number, of: number): boolean {
  return row.challenger === version && of === version;
}

type ShadowFact = Extract<
  RecordedVersionFact,
  { readonly type: 'shadow_predicted' | 'shadow_graded' | 'shadow_passed' | 'shadow_failed' }
>;

function shadowed(row: ModelsRow, fact: ShadowFact): ModelsRow {
  if (fact.type === 'shadow_predicted') {
    return ofTheChallenger(row, fact.data.version, fact.data.of)
      ? { ...row, shadow_predicted: row.shadow_predicted + 1 }
      : row;
  }
  if (fact.type === 'shadow_graded') {
    return ofTheChallenger(row, fact.data.version, fact.data.of)
      ? { ...row, shadow_graded: row.shadow_graded + 1 }
      : row;
  }
  if (row.challenger !== fact.data.version) {
    return row;
  }
  return { ...row, shadow: fact.type === 'shadow_passed' ? 'passed' : 'failed' };
}

function changed(row: ModelsRow, fact: RecordedVersionFact): ModelsRow {
  if (fact.type === 'version_built') {
    return {
      ...row,
      latest: fact.data.version,
      versions: row.versions + 1,
      challenger: fact.data.version,
      challenger_build: fact.data.build,
      shadow_predicted: 0,
      shadow_graded: 0,
      shadow: null,
    };
  }
  if (fact.type === 'version_activated') {
    const { version, data_sha256: dataSha256, file_sha256: fileSha256, file_format: fileFormat } = fact.data;
    return withoutChallenger(
      {
        ...row,
        active: version,
        active_data_sha256: dataSha256,
        active_file_sha256: fileSha256,
        active_file_format: fileFormat,
        active_definition_version: fact.data.definition_version,
      },
      version,
    );
  }
  return fact.type === 'activation_refused' ? withoutChallenger(row, fact.data.version) : shadowed(row, fact);
}

const decodeFact = strictRecordedDecoder(VersionFactSchema);

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow {
  return changed(modelsRowOf(row), decodeFact(message));
}

export const predictionModels: KeyedProjection = {
  name: predictionModelsName,
  version: 1,
  kinds: [modelsStreamKind],
  types: versionFactTypes,
  columns: [
    { name: 'active', kind: 'integer' },
    { name: 'active_data_sha256', kind: 'text' },
    { name: 'active_file_sha256', kind: 'text' },
    { name: 'active_file_format', kind: 'text' },
    { name: 'active_definition_version', kind: 'integer' },
    { name: 'latest', kind: 'integer' },
    { name: 'versions', kind: 'integer' },
    { name: 'challenger', kind: 'integer' },
    { name: 'challenger_build', kind: 'text' },
    { name: 'shadow_predicted', kind: 'integer' },
    { name: 'shadow_graded', kind: 'integer' },
    { name: 'shadow', kind: 'text' },
  ],
  indexes: [],
  rowAfter,
};
