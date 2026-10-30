import { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { SavedDefinition, SavedDefinitions } from '../capability/saved-definitions.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { loadRegistry } from './registry-access.ts';

function savedOf({ name, version, input_schema, output_schema }: StoredDefinition): SavedDefinition {
  return {
    name,
    version,
    ...(input_schema === undefined ? {} : { inputSchema: input_schema }),
    ...(output_schema === undefined ? {} : { outputSchema: output_schema }),
  };
}

function activeIn(type: string, name: string): Effect.Effect<SavedDefinition | undefined, never, PlaybookReader> {
  return Effect.map(loadRegistry(type), (registry) => {
    const stored = registry.get(name);
    return stored?.status === 'active' ? savedOf(stored) : undefined;
  });
}

export const savedDefinitions: Effect.Effect<SavedDefinitions, never, PlaybookReader> = Effect.map(
  Effect.service(PlaybookReader),
  (reader) => ({
    active: (type, name) => activeIn(type, name).pipe(Effect.provideService(PlaybookReader, reader)),
    content: (sha256) => reader.readContent(sha256),
  }),
);
