import type { StreamedContent } from '@on.auto/operations';
import type { Effect, Schema } from 'effect';

export interface SavedDefinition {
  readonly name: string;
  readonly version: number;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
}

export interface SavedDefinitions {
  readonly active: (type: string, name: string) => Effect.Effect<SavedDefinition | undefined>;
  readonly content: (sha256: string) => Effect.Effect<StreamedContent | undefined>;
}
