import { ContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

import { rememberedFields } from '../facts/memory-facts.ts';

export const MemoryRememberedErasedSchema = factOf(
  'memory_remembered',
  Schema.Struct({ ...rememberedFields, text: Schema.Null, erased_at: Schema.String }),
  ContextSchema,
);

export const MemoryErasedSchema = factOf('memory_erased', Schema.Struct({ version: Schema.Int }), ContextSchema);

export const ErasedMemoryFactSchema = Schema.Union([MemoryRememberedErasedSchema, MemoryErasedSchema]);
