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
import { definitionsDecider, definitionsFoldIn, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import { commandMetadata } from './command-metadata.ts';

interface RegistryKind {
  readonly type: string;
}

export interface DefinitionInRegistry {
  readonly registry: DefinitionRegistry;
  readonly stored: StoredDefinition;
}

export function loadRegistry(type: string): Effect.Effect<DefinitionRegistry, never, PlaybookReader | PlaybookContext> {
  return Effect.flatMap(PlaybookContext, (address) =>
    PlaybookReader.use((reader) => reader.load(definitionTypeStreamOf(type), definitionsFoldIn(address))),
  ).pipe(Effect.map(({ state }) => state));
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
  return Effect.map(recordedVersionOf(type, name, version), ({ source, stripped, putInPlaceBy }) => ({
    name,
    version,
    source,
    stripped,
    putInPlaceBy,
  }));
}

export const recordInRegistry = Effect.fnUntraced(function* ({ type }: RegistryKind, data: DefinitionCommandData) {
  const metadata = yield* commandMetadata;
  const { state, decidedOn } = yield* (yield* PlaybookWriter).execute(
    definitionTypeStreamOf(type),
    definitionsDecider(type, yield* PlaybookContext),
    {
      ...data,
      ...metadata,
    },
  );
  const stored = yield* Effect.orDie(findDefinition(state, type, data.name));
  return { registry: state, stored, newVersion: decidedOn.get(data.name)?.version !== stored.version };
});

interface Saved {
  readonly registry: DefinitionRegistry;
  readonly stored: Pick<StoredDefinition, 'version'>;
}

function holdsNothing(type: string): Effect.Effect<boolean, never, PlaybookReader | PlaybookContext> {
  return Effect.map(loadRegistry(type), (registry) => registry.size === 0);
}

export function isThePlaybooksFirst(
  types: readonly string[],
  type: string,
  { registry, stored }: Saved,
): Effect.Effect<boolean, never, PlaybookReader | PlaybookContext> {
  if (stored.version !== 1 || registry.size !== 1) {
    return Effect.succeed(false);
  }
  const others = types.filter((other) => other !== type);
  return Effect.map(Effect.forEach(others, holdsNothing, { concurrency: 'unbounded' }), (empty: readonly boolean[]) =>
    empty.every(Boolean),
  );
}
