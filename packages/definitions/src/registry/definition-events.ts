import { DefinitionContextSchema, factOf, type Decided } from '@on.auto/operations';
import { Schema } from 'effect';

import { StrippedFormsSchema } from '../capability/stripped-forms.ts';
import { TriggerSchema } from './definition-triggers.ts';

const DefinitionContentSchema = Schema.Struct({
  source: Schema.String,
  overview: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  input_schema: Schema.optionalKey(Schema.JsonObject),
  output_schema: Schema.optionalKey(Schema.JsonObject),
  warnings: Schema.optionalKey(Schema.Array(Schema.String)),
  triggers: Schema.optionalKey(Schema.Array(TriggerSchema)),
  details: Schema.optionalKey(Schema.JsonObject),
  stripped: Schema.optionalKey(StrippedFormsSchema),
});

export type DefinitionContent = typeof DefinitionContentSchema.Type;

const SavedSchema = Schema.Struct({ content: DefinitionContentSchema });

export const DefinitionEventSchema = Schema.Union([
  factOf('definition_created', SavedSchema, DefinitionContextSchema),
  factOf('definition_updated', SavedSchema, DefinitionContextSchema),
  factOf('definition_retired', Schema.Struct({}), DefinitionContextSchema),
]);

export type RecordedDefinitionEvent = typeof DefinitionEventSchema.Type;

const definitionEventTypes: Readonly<Record<RecordedDefinitionEvent['type'], true>> = {
  definition_created: true,
  definition_updated: true,
  definition_retired: true,
};

export function isDefinitionEventType(type: string): boolean {
  return Object.hasOwn(definitionEventTypes, type);
}

export type DefinitionEvent = Decided<RecordedDefinitionEvent>;

export type DefinitionCreated = Extract<RecordedDefinitionEvent, { readonly type: 'definition_created' }>;

export type DefinitionUpdated = Extract<RecordedDefinitionEvent, { readonly type: 'definition_updated' }>;
