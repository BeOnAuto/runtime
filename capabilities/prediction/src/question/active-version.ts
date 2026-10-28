import { Conflict, type PlaybookAddress, type ProjectionReader, type StreamReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { documentOfVersion } from '../builds/build-document.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { modelsRowOf, predictionModelsName, type ModelsRow } from '../models/models-projection.ts';

export interface ActiveVersion {
  readonly version: number;
  readonly file: string;
  readonly format: string;
}

export interface Answering {
  readonly ledger: StreamReader & Pick<ProjectionReader, 'readProjectedRows'>;
  readonly playbook: PlaybookAddress;
  readonly name: string;
  readonly definitionVersion: number;
  readonly document: PredictionFunctionDefinitionDocument;
}

function changed(version: number, what: string): Conflict {
  return new Conflict({
    detail: `The ${what} changed since version ${version} was built, so its model no longer fits the rows; ask for a build`,
    kind: 'data_changed',
  });
}

function signatureOf({ predicts, data }: PredictionFunctionDefinitionDocument): string {
  return JSON.stringify([predicts.horizons, data.given, predicts.accumulates ?? null]);
}

function readModelsRow({ ledger, playbook, name }: Answering): Effect.Effect<ModelsRow> {
  return Effect.map(
    ledger.readProjectedRows(predictionModelsName, playbook, {
      where: [{ column: 'row_key', equals: name }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([kept]) => modelsRowOf(kept?.row),
  );
}

function sameSignature(answering: Answering, builtOn: number): Effect.Effect<boolean> {
  const { ledger, playbook, name, definitionVersion, document } = answering;
  return builtOn === definitionVersion
    ? Effect.succeed(true)
    : Effect.map(
        documentOfVersion(ledger, playbook, name, builtOn),
        (built) => signatureOf(built) === signatureOf(document),
      );
}

export function activeVersionOf(answering: Answering): Effect.Effect<ActiveVersion | null, Conflict> {
  return Effect.gen(function* () {
    const row = yield* readModelsRow(answering);
    const { active, active_file_sha256: file, active_file_format: format } = row;
    if (active === null || file === null || format === null || row.active_definition_version === null) {
      return null;
    }
    if (row.active_data_sha256 !== answering.document.dataSha256) {
      return yield* Effect.fail(changed(active, 'data part'));
    }
    if (!(yield* sameSignature(answering, row.active_definition_version))) {
      return yield* Effect.fail(changed(active, 'horizons, the given features or the total'));
    }
    return { version: active, file, format };
  });
}
