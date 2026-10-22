import type { CompiledSchema } from '@on.auto/json-schema';
import { Schema } from 'effect';

const descriptionLength = 1000;

export const DescriptionSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(descriptionLength));

export interface ValueContract {
  readonly schema?: CompiledSchema;
}
