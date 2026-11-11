import { NotFound, type PlaybookContext, type PlaybookReader } from '@on.auto/operations';
import { payloadOf } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import type { ReadModelRefused } from './read-model-refused.ts';
import { inThePlaybookOf, versionAndSaveIn, type ReadModelReader } from './read-model-rows.ts';

export interface VersionInTheReadModel {
  readonly name: string;
  readonly version: number;
  readonly source: RegisteredDefinition['source'];
  readonly stripped: RegisteredDefinition['stripped'];
  readonly putInPlaceBy: string;
}

function versionNotFound(type: string, name: string, version: number): NotFound {
  return new NotFound({
    detail: `There is no version ${version} of the ${definitionResourceLabel(type)} ${name} in this playbook`,
  });
}

export function versionFromTheReadModelIn(
  reader: ReadModelReader,
  type: string,
  name: string,
  version: number,
): Effect.Effect<VersionInTheReadModel, NotFound | ReadModelRefused> {
  return Effect.flatMap(versionAndSaveIn(reader, type, name, version), (found) => {
    if (found === undefined) {
      return Effect.fail(versionNotFound(type, name, version));
    }
    const { content } = found.saved.data;
    return Effect.succeed({
      name,
      version,
      source: payloadOf<'source', string>(content, 'source'),
      stripped: content.stripped,
      putInPlaceBy: found.row.put_in_place_by,
    });
  });
}

export function versionFromTheReadModel(
  type: string,
  name: string,
  version: number,
): Effect.Effect<VersionInTheReadModel, NotFound | ReadModelRefused, PlaybookReader | PlaybookContext> {
  return inThePlaybookOf((reader) => versionFromTheReadModelIn(reader, type, name, version));
}
