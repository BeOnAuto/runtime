import { ContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

export const memoriesKind = 'memories';

export const MemoryScopeSchema = Schema.Literals(['playbook', 'organization']);

export type MemoryScope = typeof MemoryScopeSchema.Type;

const AboutSchema = Schema.Struct({
  from: Schema.String.annotate({ description: 'The first day the memory is about, as YYYY-MM-DD' }),
  to: Schema.String.annotate({ description: 'The last day the memory is about, as YYYY-MM-DD' }),
});

const MovedFromSchema = Schema.Struct({
  scope: MemoryScopeSchema,
  playbook: Schema.optionalKey(Schema.String),
  id: Schema.String,
});

export type MovedFrom = typeof MovedFromSchema.Type;

export const rememberedFields = {
  version: Schema.Int,
  tags: Schema.Array(Schema.String),
  about: Schema.optionalKey(AboutSchema),
  expires_at: Schema.optionalKey(Schema.String),
  replaces_version: Schema.optionalKey(Schema.Int),
  moved_from: Schema.optionalKey(MovedFromSchema),
};

export const MemoryRememberedSchema = factOf(
  'memory_remembered',
  Schema.Struct({ ...rememberedFields, text: Schema.String }),
  ContextSchema,
);

export const MemoryForgottenSchema = factOf('memory_forgotten', Schema.Struct({ version: Schema.Int }), ContextSchema);

export const MemoryMovedSchema = factOf(
  'memory_moved',
  Schema.Struct({ to: MemoryScopeSchema, as: Schema.String, playbook: Schema.optionalKey(Schema.String) }),
  ContextSchema,
);

export type MovedTo = (typeof MemoryMovedSchema.Type)['data'];

export const KeptMemoryFactSchema = Schema.Union([MemoryRememberedSchema, MemoryForgottenSchema, MemoryMovedSchema]);

export type RememberedData = (typeof MemoryRememberedSchema.Type)['data'];
