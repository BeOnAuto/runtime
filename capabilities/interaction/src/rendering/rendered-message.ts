import type { Schema } from 'effect';

export interface RenderedMessage {
  readonly payload: Schema.Json;
  readonly text: string;
}

export interface RenderState {
  readonly input: Schema.Json;
  readonly today: string;
  readonly now: string;
}
