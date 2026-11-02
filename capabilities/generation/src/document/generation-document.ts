import type { SourceLines, ValueContract } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';

import type { GenerationKind } from '../catalog/catalog-entry.ts';

export interface GenerationParameters {
  readonly size?: string;
  readonly aspect?: string;
  readonly quality?: string;
  readonly voice?: string;
  readonly format?: string;
  readonly duration?: number;
}

export type ParameterName = keyof GenerationParameters;

export interface GenerationFunctionDefinitionDocument {
  readonly description?: string;
  readonly produces: GenerationKind;
  readonly model: string;
  readonly input: ValueContract;
  readonly parameters: GenerationParameters;
  readonly references: readonly string[];
  readonly expiresMs?: number;
  readonly prompt: ParsedTemplate;
  readonly lines: SourceLines;
}
