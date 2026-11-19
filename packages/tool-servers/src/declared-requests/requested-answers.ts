import { extractWWWAuthenticateParams } from '@modelcontextprotocol/client';
import { boundedAnswerOf } from '@on.auto/outbound';
import type { Schema } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { answerDocument } from '../bounds/tool-results.ts';
import { AnsweredStatus, failsByItsStatus, isARedirect } from '../openapi/answered-status.ts';
import { refusalOf, type FailureCodes } from '../openapi/failure-codes.ts';

export type RequestSettled =
  | { readonly outcome: 'result'; readonly answer?: Schema.Json }
  | { readonly outcome: 'tool_error' | 'not_found' | 'too_large' }
  | { readonly error: unknown };

const notFound = 404;

const gone = 410;

function isNotThere(status: number): boolean {
  return status === notFound || status === gone;
}

interface ReadAnswer {
  readonly text: string;
  readonly answer: Schema.Json | undefined;
}

function refusedIn(
  response: Readonly<Response>,
  { text, answer }: ReadAnswer,
  codes: FailureCodes | undefined,
): RequestSettled | undefined {
  const { status } = response;
  const challenge = extractWWWAuthenticateParams(response);
  const json = codes === undefined || answer === undefined ? undefined : { parsed: answer };
  const refused = refusalOf({ status, text, challenge, json }, codes ?? null);
  if (refused === undefined) {
    return undefined;
  }
  return refused.error === undefined ? { outcome: 'tool_error' } : { error: refused.error };
}

function readFrom(response: Readonly<Response>, text: string, codes: FailureCodes | undefined): RequestSettled {
  const answer = answerDocument({ content: text === '' ? [] : [{ type: 'text', text }] });
  const refused = refusedIn(response, { text, answer }, codes);
  if (refused !== undefined) {
    return refused;
  }
  if (isNotThere(response.status)) {
    return { outcome: 'not_found' };
  }
  if (response.status >= 300) {
    return { outcome: 'tool_error' };
  }
  return answer === undefined ? { outcome: 'result' } : { outcome: 'result', answer };
}

async function unreadSettled(response: Readonly<Response>): Promise<RequestSettled> {
  await response.body?.cancel();
  return failsByItsStatus(response.status) ? { error: new AnsweredStatus(response.status) } : { outcome: 'tool_error' };
}

export async function settledRequestOf(response: Readonly<Response>, codes?: FailureCodes): Promise<RequestSettled> {
  if (failsByItsStatus(response.status) || isARedirect(response.status)) {
    return unreadSettled(response);
  }
  let tooLarge = false;
  try {
    const text = await boundedAnswerOf(response, toolBounds.readAnswerBytes, () => {
      tooLarge = true;
    }).text();
    return readFrom(response, text, codes);
  } catch (error) {
    return tooLarge ? { outcome: 'too_large' } : { error };
  }
}
