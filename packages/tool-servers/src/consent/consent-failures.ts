import { IssuerMismatchError, OAuthError, OAuthErrorCode } from '@modelcontextprotocol/client';

import { failureOf } from '../clients/server-failures.ts';
import type { ConsentRefusal } from './consent-client.ts';

type RequestRefusal = Extract<ConsentRefusal, { readonly refused: 'host' | 'unanswered' }>;

export const unanswered: RequestRefusal = { refused: 'unanswered' };

const invalidGrant: string = OAuthErrorCode.InvalidGrant;

export function refusalOf(error: unknown): RequestRefusal {
  const failure = failureOf(error);
  return failure.kind === 'not_allowed' ? { refused: 'host', rule: failure.message } : unanswered;
}

export function discoveryRefusalOf(error: unknown): ConsentRefusal {
  return error instanceof IssuerMismatchError
    ? { refused: 'another_issuer', named: String(error.received), by: 'authorization_server' }
    : refusalOf(error);
}

export function isInvalidGrant(error: unknown): boolean {
  return error instanceof OAuthError && error.code === invalidGrant;
}

export function exchangeRefusalOf(error: unknown): ConsentRefusal {
  if (error instanceof IssuerMismatchError) {
    return { refused: 'iss' };
  }
  return isInvalidGrant(error) ? { refused: 'code' } : refusalOf(error);
}
