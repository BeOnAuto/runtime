import {
  definitionOfStreamPrefix,
  messageIdOf,
  type NotFound,
  PlaybookContext,
  PlaybookReader,
  PlaybookWriter,
  streamPrefixOfDefinition,
  type Fold,
  type Recorded,
} from '@on.auto/operations';
import type { HeldName } from '@on.auto/operations/definition-names';
import { Effect, Option } from 'effect';

import type { DefinitionCommand, DefinitionCommandData } from '../registry/definition-commands.ts';
import type { DefinitionRegistry, DefinitionState, RegisteredDefinition } from '../registry/definition-registry.ts';
import { definitionVersionFold, type RecordedVersion } from '../registry/definition-versions.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { definitionDecider, definitionFoldOf, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { definitionNotFound, versionNotFound } from '../registry/registry-lookup.ts';
import { commandMetadata } from './command-metadata.ts';

interface RegistryKind {
  readonly type: string;
}

export interface DefinitionInRegistry {
  readonly stored: StoredDefinition;
}

function definitionsHeldBy(held: readonly HeldName[]): readonly string[] {
  return held.flatMap(({ definitionKey }) =>
    Option.toArray(Option.map(definitionOfStreamPrefix(definitionKey), ({ definition }) => definition)),
  );
}

function holderOf(type: string, name: string): Effect.Effect<string | undefined, never, PlaybookReader> {
  return PlaybookReader.use((reader) =>
    Effect.map(reader.holderOfName(type, name), (held) =>
      held === undefined ? undefined : definitionsHeldBy([held]).at(0),
    ),
  );
}

function loadedDefinition(type: string, definition: string): Effect.Effect<DefinitionState, never, PlaybookReader> {
  return PlaybookReader.use((reader) =>
    reader.ofDefinition(definition).load(definitionTypeStreamOf(type), definitionFoldOf(definition)),
  ).pipe(Effect.map(({ state }) => state));
}

export function loadEachHeld<State, Event extends Recorded>(
  type: string,
  foldOf: (definition: string) => Fold<State, Event>,
): Effect.Effect<readonly State[], never, PlaybookReader> {
  return Effect.flatMap(
    PlaybookReader.use((reader) => reader.namesHeldIn(type)),
    (held) =>
      Effect.forEach(definitionsHeldBy(held), (definition) =>
        PlaybookReader.use((reader) =>
          reader.ofDefinition(definition).load(definitionTypeStreamOf(type), foldOf(definition)),
        ).pipe(Effect.map(({ state }) => state)),
      ),
  );
}

export function loadRegistry(type: string): Effect.Effect<DefinitionRegistry, never, PlaybookReader> {
  return Effect.map(
    loadEachHeld(type, definitionFoldOf),
    (loaded) =>
      new Map(
        loaded
          .filter((definition): definition is RegisteredDefinition => definition !== undefined)
          .map((definition) => [definition.name, definition]),
      ),
  );
}

export function loadDefinition(
  type: string,
  name: string,
): Effect.Effect<RegisteredDefinition | undefined, never, PlaybookReader> {
  return Effect.flatMap(holderOf(type, name), (definition) =>
    definition === undefined ? Effect.undefined : loadedDefinition(type, definition),
  );
}

export function foundDefinition(
  type: string,
  name: string,
): Effect.Effect<RegisteredDefinition, NotFound, PlaybookReader> {
  return Effect.flatMap(loadDefinition(type, name), (stored) =>
    stored === undefined ? Effect.fail(definitionNotFound(type, name)) : Effect.succeed(stored),
  );
}

interface VersionOfADefinition {
  readonly type: string;
  readonly definition: string;
  readonly name: string;
  readonly version: number;
}

function recordedVersionIn({
  type,
  definition,
  name,
  version,
}: VersionOfADefinition): Effect.Effect<RecordedVersion, NotFound, PlaybookReader> {
  return PlaybookReader.use((reader) =>
    reader.ofDefinition(definition).load(definitionTypeStreamOf(type), definitionVersionFold(version)),
  ).pipe(
    Effect.flatMap(({ state: { found } }) =>
      found === undefined ? Effect.fail(versionNotFound(type, name, version)) : Effect.succeed(found),
    ),
  );
}

export const triggersSince = Effect.fnUntraced(function* (
  type: string,
  { name, definition_id: definition, version }: StoredDefinition,
) {
  const { position } = yield* Effect.orDie(recordedVersionIn({ type, definition, name, version }));
  const { org } = yield* PlaybookContext;
  return messageIdOf(`${streamPrefixOfDefinition({ org, definition })}${definitionTypeStreamOf(type)}`, position);
});

export function versionOf(type: string, name: string, version: number) {
  return Effect.flatMap(holderOf(type, name), (definition) =>
    definition === undefined
      ? Effect.fail(versionNotFound(type, name, version))
      : Effect.map(recordedVersionIn({ type, definition, name, version }), ({ source, stripped, putInPlaceBy }) => ({
          name,
          version,
          definition_id: definition,
          source,
          stripped,
          putInPlaceBy,
        })),
  );
}

function definitionOfTheCommand(
  type: string,
  data: DefinitionCommandData,
): Effect.Effect<string, NotFound, PlaybookReader> {
  if (data.type === 'create') {
    return Effect.succeed(data.definition_id);
  }
  return Effect.flatMap(holderOf(type, data.name), (definition) =>
    definition === undefined ? Effect.fail(definitionNotFound(type, data.name)) : Effect.succeed(definition),
  );
}

export const recordedWith = Effect.fnUntraced(function* (type: string, command: DefinitionCommand) {
  const definition = yield* definitionOfTheCommand(type, command);
  const writer = (yield* PlaybookWriter).ofDefinition(definition);
  const { state, decidedOn } = yield* writer.execute(
    definitionTypeStreamOf(type),
    definitionDecider(type, yield* PlaybookContext, definition),
    command,
  );
  const stored = yield* Effect.orDie(Effect.fromNullishOr(state));
  return { stored, newVersion: decidedOn?.version !== stored.version };
});

export const recordInRegistry = Effect.fnUntraced(function* ({ type }: RegistryKind, data: DefinitionCommandData) {
  return yield* recordedWith(type, { ...data, ...(yield* commandMetadata) });
});

export function isThePlaybooksFirst(types: readonly string[]): Effect.Effect<boolean, never, PlaybookReader> {
  return Effect.map(
    Effect.forEach(types, (type) => PlaybookReader.use((reader) => reader.namesHeldIn(type))),
    (held: readonly (readonly HeldName[])[]) => held.flat().length === 1,
  );
}
