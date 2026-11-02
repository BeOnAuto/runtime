import type { Decided } from '@on.auto/operations';
import { Schema } from 'effect';

import { MemoryErasedSchema, MemoryRememberedErasedSchema } from '../forget/erased-facts.ts';
import { MemoryForgottenSchema, MemoryMovedSchema, MemoryRememberedSchema } from './memory-facts.ts';

export const MemoryFactSchema = Schema.Union([
  MemoryRememberedSchema,
  MemoryRememberedErasedSchema,
  MemoryForgottenSchema,
  MemoryErasedSchema,
  MemoryMovedSchema,
]);

export type RecordedMemoryFact = typeof MemoryFactSchema.Type;

export type MemoryFact = Decided<RecordedMemoryFact>;

export type RecordedRemembered = Extract<RecordedMemoryFact, { readonly type: 'memory_remembered' }>;
