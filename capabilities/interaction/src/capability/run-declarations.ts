import { longestCallRunMs } from '@on.auto/definitions/tool-blocks';

import type { InteractionFunctionDefinitionDocument, SignInDocument } from '../document/interaction-document.ts';
import { asksLater } from '../run/interaction-run.ts';

function signInAsks({ whenSignedOut }: SignInDocument): boolean {
  return whenSignedOut.answer === 'ask';
}

export function finishesLater(document: InteractionFunctionDefinitionDocument): boolean {
  if (document.shape === 'sign_in') {
    return signInAsks(document);
  }
  return document.shape === 'request' && asksLater(document);
}

export function callsTools({ shape }: InteractionFunctionDefinitionDocument): boolean {
  return shape === 'call' || shape === 'sign_in';
}

function longestSignInOf({ whenSignedOut }: SignInDocument): number {
  return whenSignedOut.answer === 'ask' ? whenSignedOut.asking.expiresMs : longestCallRunMs;
}

export function longestRunOf(document: InteractionFunctionDefinitionDocument): number {
  if (document.shape === 'sign_in') {
    return longestSignInOf(document);
  }
  return document.shape === 'call' ? longestCallRunMs : document.expiresMs;
}
