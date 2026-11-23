import { mostListingBytes } from '@on.auto/api';
import {
  conversationBytesWithin,
  INSTRUCTIONS_ALLOWANCE_BYTES,
  MEMORY_BOUNDS,
  TURN_BOUNDS,
  type ChatModel,
  type MemoryBounds,
  type TurnBounds,
} from '@on.auto/chat';

export interface ModelLimits {
  readonly contextWindow?: number | undefined;
  readonly mostOutputTokens?: number | undefined;
}

export interface TurnModels {
  readonly refusalOf: (model: string) => Promise<string | undefined>;
  readonly limitsOf: (model: string) => Promise<ModelLimits>;
  readonly generate: (model: string) => ChatModel<never>['generate'];
}

export interface ChosenModel {
  readonly model: ChatModel<never>;
  readonly bounds: Pick<TurnBounds, 'requestInputTokens' | 'outputTokens'>;
  readonly memory: MemoryBounds;
}

export type ModelOfATurn = { readonly chosen: ChosenModel } | { readonly unavailable: 'unchosen' | 'not_offered' };

const unbounded = Number.POSITIVE_INFINITY;

export function boundsFor(
  { contextWindow, mostOutputTokens }: ModelLimits,
  defaults: Pick<TurnBounds, 'requestInputTokens' | 'outputTokens'> = TURN_BOUNDS,
): Pick<ChosenModel, 'bounds' | 'memory'> {
  const outputTokens = Math.min(defaults.outputTokens, mostOutputTokens ?? unbounded);
  const requestInputTokens = Math.min(defaults.requestInputTokens, (contextWindow ?? unbounded) - outputTokens);
  const conversationBytes = conversationBytesWithin({
    requestInputTokens,
    listingBytes: mostListingBytes.directory,
    instructionsBytes: INSTRUCTIONS_ALLOWANCE_BYTES,
  });
  return { bounds: { requestInputTokens, outputTokens }, memory: { ...MEMORY_BOUNDS, conversationBytes } };
}

export async function modelOfATurn(models: TurnModels, chosen: string | null): Promise<ModelOfATurn> {
  if (chosen === null) {
    return { unavailable: 'unchosen' };
  }
  if ((await models.refusalOf(chosen)) !== undefined) {
    return { unavailable: 'not_offered' };
  }
  const limits = await models.limitsOf(chosen);
  return { chosen: { model: { name: chosen, generate: models.generate(chosen) }, ...boundsFor(limits) } };
}
