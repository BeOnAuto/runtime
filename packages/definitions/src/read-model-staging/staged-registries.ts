import type { PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { loadRegistry } from '../operations/registry-access.ts';
import { registryFromTheReadModel } from '../read-model-reads/read-model-stored.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import { DefinitionsReadModel, pathOf } from './read-model-stage.ts';
import { fellBackMessage } from './shadow-comparison.ts';

function readModelOrFold(type: string): Effect.Effect<DefinitionRegistry, never, PlaybookReader | PlaybookContext> {
  return Effect.catchCause(registryFromTheReadModel(type), () =>
    Effect.andThen(
      Effect.logWarning(fellBackMessage).pipe(Effect.annotateLogs({ read: 'registry', definition_type: type })),
      loadRegistry(type),
    ),
  );
}

export function stagedRegistry(
  type: string,
): Effect.Effect<DefinitionRegistry, never, PlaybookReader | PlaybookContext> {
  return Effect.flatMap(Effect.service(DefinitionsReadModel), (staged) =>
    pathOf(staged, 'answers', [type]) === 'read_model' ? readModelOrFold(type) : loadRegistry(type),
  );
}
