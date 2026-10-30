import { Conflict } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { Capability, PreparedDefinition } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import { shapeNameIn } from '../shapes/published-output.ts';
import type { OutputShapeName } from '../shapes/shape-names.ts';
import type { Rejection } from './issue-pointers.ts';
import { loadRegistry, versionOf } from './registry-access.ts';

const activeDefinition = Effect.fnUntraced(function* (type: string, name: string) {
  const definition = yield* findDefinition(yield* loadRegistry(type), type, name);
  if (definition.status === 'retired') {
    return yield* new Conflict({
      detail: `The ${definitionResourceLabel(type)} ${name} is retired and can no longer be run`,
      kind: 'retired',
    });
  }
  return definition;
});

function unparseable(
  type: string,
  { name, version }: Pick<StoredDefinition, 'name' | 'version'>,
): (rejection: Rejection) => Conflict {
  return ({ detail }) =>
    new Conflict({
      detail: `The ${definitionResourceLabel(type)} ${name} at version ${version} no longer parses (${detail}); update it`,
      kind: 'unworkable',
    });
}

export interface VersionToRun {
  readonly name: string;
  readonly version: number;
  readonly source: string;
}

export const preparedDefinition = Effect.fnUntraced(function* (capability: Capability, name: string) {
  const definition = yield* activeDefinition(capability.type, name);
  const prepared = yield* capability
    .prepare(definition.source, definition.stripped)
    .pipe(Effect.mapError(unparseable(capability.type, definition)));
  return { definition, prepared };
});

export const preparedVersion = Effect.fnUntraced(function* (capability: Capability, name: string, version: number) {
  const definition = yield* versionOf(capability.type, name, version);
  const prepared = yield* capability
    .prepare(definition.source, definition.stripped)
    .pipe(Effect.mapError(unparseable(capability.type, definition)));
  return { definition, prepared };
});

export function outputShapeOf(prepared: PreparedDefinition, input: Schema.Json): OutputShapeName | undefined {
  return prepared.answersItsShapeFor(input) ? shapeNameIn(prepared.summary.details) : undefined;
}
