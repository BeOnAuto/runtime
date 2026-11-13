import type { Result, Schema } from 'effect';

import { renderTargetOf, type RenderTargetName } from './render-targets.ts';
import type { RenderedMessage, RenderState } from './rendered-message.ts';

export function renderedCard(
  target: RenderTargetName,
  card: Schema.Json,
  state: RenderState,
): Result.Result<RenderedMessage, readonly string[]> {
  return renderTargetOf(target).render(card, state);
}
