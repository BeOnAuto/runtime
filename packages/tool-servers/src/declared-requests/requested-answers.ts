import { extractWWWAuthenticateParams } from '@modelcontextprotocol/client';
import { boundedAnswerOf } from '@on.auto/outbound';
import type { Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { answerDocument } from '../bounds/tool-results.ts';
import { AnsweredStatus, failsByItsStatus, isARedirect } from '../openapi/answered-status.ts';
import { refusalOf } from '../openapi/failure-codes.ts';

export type RequestSettled =
  | { readonly outcome: 'result'; readonly answer?: Schema.Json }
  | { readonly outcome: 'tool_error' | 'too_large' }
  | { readonly error: unknown };

function readFrom(response: Readonly<Response>, text: string): RequestSettled {
  const { status } = response;
  const challenge = extractWWWAuthenticateParams(response);
  const refused = refusalOf({ status, text, challenge, json: undefined }, null);
  if (refused !== undefined) {
    return { error: refused.error };
  }
  if (status >= 300) {
    return { outcome: 'tool_error' };
  }
  const answer = answerDocument({ content: text === '' ? [] : [{ type: 'text', text }] });
  return answer === undefined ? { outcome: 'result' } : { outcome: 'result', answer };
}

async function unreadSettled(response: Readonly<Response>): Promise<RequestSettled> {
  await response.body?.cancel();
  return failsByItsStatus(response.status) ? { error: new AnsweredStatus(response.status) } : { outcome: 'tool_error' };
}

export async function settledRequestOf(response: Readonly<Response>): Promise<RequestSettled> {
  if (failsByItsStatus(response.status) || isARedirect(response.status)) {
    return unreadSettled(response);
  }
  let tooLarge = false;
  try {
    const text = await boundedAnswerOf(response, toolBounds.readAnswerBytes, () => {
      tooLarge = true;
    }).text();
    return readFrom(response, text);
  } catch (error) {
    return tooLarge ? { outcome: 'too_large' } : { error };
  }
}
