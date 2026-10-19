import type { CompiledSchema } from '@on.auto/json-schema';
import { Schema } from 'effect';

const descriptionLength = 1000;

const aboutLength = 4000;

export const DescriptionSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(descriptionLength));

export const AboutSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(aboutLength));

export interface ValueContract {
  readonly schema?: CompiledSchema;
}
