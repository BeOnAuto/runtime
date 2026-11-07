import { longestCallRunMs } from '@on.auto/definitions/tool-blocks';

import type { InteractionFunctionDefinitionDocument } from '../document/interaction-document.ts';
import { asksLater } from '../run/interaction-run.ts';

export function finishesLater(document: InteractionFunctionDefinitionDocument): boolean {
  return document.shape === 'request' && asksLater(document);
}

export function callsTools({ shape }: InteractionFunctionDefinitionDocument): boolean {
  return shape === 'call';
}

export function longestRunOf(document: InteractionFunctionDefinitionDocument): number {
  return document.shape === 'call' ? longestCallRunMs : document.expiresMs;
}
