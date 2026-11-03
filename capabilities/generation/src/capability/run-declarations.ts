import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import { gatewayAnswerMs } from '../gateway/generation-gateway.ts';
import { fetchInFlightMs } from '../waiting/poll-cadence.ts';
import { generationBounds, type GenerationPorts } from './generation-ports.ts';

export const longestGenerationMs = 300_000;

type Produced = Pick<GenerationFunctionDefinitionDocument, 'produces'>;

export function finishesLater({ produces }: Produced): boolean {
  return produces === 'video';
}

export function longestRunOf({
  answerMs = gatewayAnswerMs,
  bounds = generationBounds,
}: Pick<GenerationPorts, 'answerMs' | 'bounds'>) {
  const longestWaitedMs = answerMs + bounds.waitMs + fetchInFlightMs(answerMs);
  return (document: Produced): number => (finishesLater(document) ? longestWaitedMs : longestGenerationMs);
}
