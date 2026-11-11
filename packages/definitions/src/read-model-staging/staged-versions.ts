import type { NotFound, PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { versionOf } from '../operations/registry-access.ts';
import { versionFromTheReadModel, type VersionInTheReadModel } from '../read-model-reads/read-model-versions.ts';
import { differingFieldsOf } from './same-answers.ts';
import { comparisonOf, stagedRead } from './shadow-comparison.ts';

export function stagedVersion(
  type: string,
  name: string,
  version: number,
): Effect.Effect<VersionInTheReadModel, NotFound, PlaybookReader | PlaybookContext> {
  return stagedRead({
    read: 'version',
    reading: 'run_starts',
    definitionType: type,
    involved: [type],
    today: versionOf(type, name, version),
    fromTheReadModel: versionFromTheReadModel(type, name, version),
    answerOf: (found) => found,
    compared: (found, candidate) => Effect.succeed(comparisonOf(differingFieldsOf(found, candidate))),
  });
}
