import { DefinitionContextSchema, RecordedCallerSchema, factOf, type Decided } from '@on.auto/operations';
import { payloadFields, payloadPointersOf, withPayloads } from '@on.auto/operations/payloads';
import { Schema } from 'effect';

import { StrippedFormsSchema } from '../capability/stripped-forms.ts';
import { PageContentSchema } from '../page/page-facts.ts';
import { TriggerSchema } from './definition-triggers.ts';

const DefinitionContentSchema = withPayloads(
  Schema.Struct({
    ...payloadFields('source', Schema.String),
    ...payloadFields('overview', Schema.String),
    ...payloadFields('diagram', Schema.String),
    description: Schema.optionalKey(Schema.String),
    input_schema: Schema.optionalKey(Schema.JsonObject),
    output_schema: Schema.optionalKey(Schema.JsonObject),
    warnings: Schema.optionalKey(Schema.Array(Schema.String)),
    triggers: Schema.optionalKey(Schema.Array(TriggerSchema)),
    details: Schema.optionalKey(Schema.JsonObject),
    stripped: Schema.optionalKey(StrippedFormsSchema),
    page: Schema.optionalKey(Schema.NullOr(PageContentSchema)),
  }),
  ['source'],
  ['overview', 'diagram'],
);

export type DefinitionContent = typeof DefinitionContentSchema.Type;

const definitionContentPayloads = ['source', 'overview', 'diagram'].map((name) => payloadPointersOf(name, '/content'));

const keepsItsTexts = { content: { payloads: definitionContentPayloads } };

const SavedSchema = Schema.Struct({ content: DefinitionContentSchema });

export const DefinitionEventSchema = Schema.Union([
  factOf(
    'definition_created',
    Schema.Struct({ ...SavedSchema.fields, created_by: RecordedCallerSchema }),
    DefinitionContextSchema,
    keepsItsTexts,
  ),
  factOf('definition_updated', SavedSchema, DefinitionContextSchema, keepsItsTexts),
  factOf('definition_retired', Schema.Struct({}), DefinitionContextSchema),
  factOf(
    'definition_paused',
    Schema.Struct({ paused_by: RecordedCallerSchema, reason: Schema.optionalKey(Schema.String) }),
    DefinitionContextSchema,
  ),
  factOf('definition_resumed', Schema.Struct({}), DefinitionContextSchema),
  factOf(
    'definition_restored',
    Schema.Struct({ ...SavedSchema.fields, restored_by: RecordedCallerSchema }),
    DefinitionContextSchema,
    keepsItsTexts,
  ),
]);

export type RecordedDefinitionEvent = typeof DefinitionEventSchema.Type;

export type DefinitionEvent = Decided<RecordedDefinitionEvent>;

export type DefinitionCreated = Extract<RecordedDefinitionEvent, { readonly type: 'definition_created' }>;

export type DefinitionUpdated = Extract<RecordedDefinitionEvent, { readonly type: 'definition_updated' }>;

export type DefinitionSaved = DefinitionCreated | DefinitionUpdated;

export type DefinitionPaused = Extract<RecordedDefinitionEvent, { readonly type: 'definition_paused' }>;

export type DefinitionRestored = Extract<RecordedDefinitionEvent, { readonly type: 'definition_restored' }>;

export type DefinitionWithContent = DefinitionSaved | DefinitionRestored;

export const definitionFactTypes: readonly RecordedDefinitionEvent['type'][] = [
  'definition_created',
  'definition_updated',
  'definition_retired',
  'definition_paused',
  'definition_resumed',
  'definition_restored',
];

export function isDefinitionSaved(event: RecordedDefinitionEvent): event is DefinitionSaved {
  return event.type === 'definition_created' || event.type === 'definition_updated';
}

export function carriesContent(event: RecordedDefinitionEvent): event is DefinitionWithContent {
  return isDefinitionSaved(event) || event.type === 'definition_restored';
}
