import { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import { sourceToPrepare } from './definition-views.ts';
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
    .prepare(sourceToPrepare(capability.type, definition.source), definition.stripped)
    .pipe(Effect.mapError(unparseable(capability.type, definition)));
  return { definition, prepared };
});

export const preparedVersion = Effect.fnUntraced(function* (capability: Capability, name: string, version: number) {
  const definition = yield* versionOf(capability.type, name, version);
  const prepared = yield* capability
    .prepare(sourceToPrepare(capability.type, definition.source), definition.stripped)
    .pipe(Effect.mapError(unparseable(capability.type, definition)));
  return { definition, prepared };
});
