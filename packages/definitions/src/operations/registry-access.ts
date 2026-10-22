import {
  PlaybookContext,
  PlaybookReader,
  PlaybookWriter,
  messageIdOf,
  NotFound,
  streamPrefixOfPlaybook,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { DefinitionCommandData } from '../registry/definition-commands.ts';
import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import { definitionVersionFold, type RecordedVersion } from '../registry/definition-versions.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { definitionsDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import { commandMetadata } from './command-metadata.ts';

export function loadRegistry(type: string): Effect.Effect<DefinitionRegistry, never, PlaybookReader> {
  return PlaybookReader.use((reader) => reader.load(definitionTypeStreamOf(type), definitionsDecider(type))).pipe(
    Effect.map(({ state }) => state),
  );
}

function recordedVersionOf(
  type: string,
  name: string,
  version: number,
): Effect.Effect<RecordedVersion, NotFound, PlaybookReader> {
  return PlaybookReader.use((reader) =>
    reader.load(definitionTypeStreamOf(type), definitionVersionFold(name, version)),
  ).pipe(
    Effect.flatMap(({ state: { found } }) =>
      found === undefined
        ? Effect.fail(
            new NotFound({
              detail: `There is no version ${version} of the ${definitionResourceLabel(type)} ${name} in this playbook`,
            }),
          )
        : Effect.succeed(found),
    ),
  );
}

export const triggersSince = Effect.fnUntraced(function* (type: string, { name, version }: StoredDefinition) {
  const { position } = yield* Effect.orDie(recordedVersionOf(type, name, version));
  return messageIdOf(`${streamPrefixOfPlaybook(yield* PlaybookContext)}${definitionTypeStreamOf(type)}`, position);
});

export function versionOf(type: string, name: string, version: number) {
  return Effect.map(recordedVersionOf(type, name, version), ({ source, stripped }) => ({
    name,
    version,
    source,
    stripped,
  }));
}

export const recordInRegistry = Effect.fnUntraced(function* (
  { type, mostActive }: { readonly type: string; readonly mostActive: number },
  data: DefinitionCommandData,
) {
  const metadata = yield* commandMetadata;
  const { state } = yield* (yield* PlaybookWriter).execute(
    definitionTypeStreamOf(type),
    definitionsDecider(type, mostActive),
    {
      ...data,
      ...metadata,
    },
  );
  return yield* Effect.orDie(findDefinition(state, type, data.name));
});
