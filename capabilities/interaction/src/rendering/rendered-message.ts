import type { Schema } from 'effect';

import type { AnswerButton } from './answer-buttons.ts';

export interface RenderedMessage {
  readonly payload: Schema.Json;
  readonly text: string;
  readonly buttons?: readonly AnswerButton[];
}

export interface RenderState {
  readonly input: Schema.Json;
  readonly today: string;
  readonly now: string;
  readonly answer?: Schema.Json;
  readonly answered?: Schema.Json;
  readonly finished?: 'answered' | 'closed';
}
