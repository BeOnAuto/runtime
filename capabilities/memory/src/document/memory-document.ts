import type { ValueContract } from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';

import type { MemoryScope } from '../facts/memory-facts.ts';
import type { RecallScope } from './memory-scopes.ts';

export interface WrittenText {
  readonly pointer: string;
  readonly template: ParsedTemplate;
}

export interface WrittenSpan {
  readonly from: WrittenText;
  readonly to: WrittenText;
}

export interface RememberBlock {
  readonly text: WrittenText;
  readonly tags: readonly WrittenText[];
  readonly scope: MemoryScope;
  readonly about?: WrittenSpan;
  readonly expires?: WrittenText;
  readonly replaces?: WrittenText;
}

export interface RecallBlock {
  readonly words?: WrittenText;
  readonly tags: readonly WrittenText[];
  readonly scope: RecallScope;
  readonly mostCharacters: number;
}

export type MemoryBlock =
  | { readonly kind: 'remember'; readonly remember: RememberBlock }
  | { readonly kind: 'recall'; readonly recall: RecallBlock };

export interface MemoryFunctionDefinitionDocument {
  readonly description?: string;
  readonly input: ValueContract;
  readonly block: MemoryBlock;
}
