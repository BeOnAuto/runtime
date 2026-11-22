import type { ModelFailure, ModelRequest, ModelResult } from '@on.auto/reasoning';

export interface ConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export type ModelAnswered<Refused> =
  | { readonly answered: ModelResult }
  | { readonly failed: ModelFailure }
  | { readonly refused: Refused };

export interface ChatModel<Refused> {
  readonly name: string;
  readonly generate: (request: ModelRequest, signal?: Readonly<AbortSignal>) => Promise<ModelAnswered<Refused>>;
}
