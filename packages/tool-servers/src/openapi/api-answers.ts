import { extractWWWAuthenticateParams } from '@modelcontextprotocol/client';

import { decodeToolResult } from '../bounds/tool-results.ts';
import { retryAfterMsOf, type Observed } from '../clients/observed-requests.ts';
import type { CallSettled } from '../clients/server-client.ts';
import { fileBytesOf, fileTextOf, shownTextIn, shownTextOf, unreadFiles, type AnsweredFile } from './answer-bodies.ts';
import { AnsweredStatus, answeredToACall, failsByItsStatus, isARedirect } from './answered-status.ts';
import { headersCarriedBy, unschemedAnswers, type AnswerSchemas } from './api-parameters.ts';
import { answerAsDescribed } from './described-answers.ts';
import { DocumentTooLarge } from './document-too-large.ts';
import { refusalOf, type FailureCodes } from './failure-codes.ts';

export interface Answering {
  readonly requestIdHeader: string | null;
  readonly failureCodes: FailureCodes | null;
  readonly now: () => number;
  readonly input: unknown;
  readonly assets: Parameters<typeof answeredToACall>[2];
}

interface ContentBlock {
  readonly type: string;
  readonly text?: string;
}

interface Answer {
  readonly content: readonly ContentBlock[];
  readonly structuredContent?: unknown;
  readonly isError?: true;
}

const jsonMediaType = /^application\/(?:[\w.-]+\+)?json$/u;

function mediaTypeOf(response: Readonly<Response>): string | undefined {
  const written = response.headers.get('content-type')?.split(';', 1).join('').trim().toLowerCase();
  return written === undefined || written === '' ? undefined : written;
}

function isJson(mediaType: string | undefined): boolean {
  return mediaType !== undefined && jsonMediaType.test(mediaType);
}

function observedOf(response: Readonly<Response>, answering: Answering, tooLarge: boolean): Observed {
  const { requestIdHeader, now } = answering;
  return {
    id: null,
    response: {
      retryAfterMs: retryAfterMsOf(response.headers.get('retry-after'), now()),
      serverRequestId: requestIdHeader === null ? null : response.headers.get(requestIdHeader),
      tooLarge,
    },
  };
}

function parsedJson(text: string): { readonly parsed: unknown } | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return { parsed };
  } catch {
    return undefined;
  }
}

function jsonAnswer(text: string, parsed: unknown, answers: AnswerSchemas): Answer {
  const decoded = answerAsDescribed(parsed, answers);
  return {
    content: [{ type: 'text', text: decoded === parsed ? text : JSON.stringify(decoded) }],
    structuredContent: decoded,
  };
}

function textAnswer(text: string): Answer {
  return text === '' ? { content: [] } : { content: [{ type: 'text', text }] };
}

function errorAnswer(text: string): Answer {
  return { content: [{ type: 'text', text }], isError: true };
}

type Parsed = ReturnType<typeof parsedJson>;

interface ReadAsJson {
  readonly text: string;
  readonly json: Parsed;
}

function jsonWithinTheBound(bytes: Readonly<Uint8Array>): ReadAsJson | undefined {
  const text = shownTextIn(bytes);
  const json = text === undefined ? undefined : parsedJson(text);
  return text === undefined || json === undefined ? undefined : { text, json };
}

function jsonOf(text: string, mediaType: string | undefined, failureCodes: FailureCodes | null): Parsed {
  return isJson(mediaType) || failureCodes !== null ? parsedJson(text) : undefined;
}

function shownAnswer(status: number, shown: Shown): Answer {
  const { text, json, answers, input, assets } = shown;
  if (status >= 300) {
    return errorAnswer(text === '' ? answeredToACall(status, input, assets) : text);
  }
  return json === undefined ? textAnswer(text) : jsonAnswer(text, json.parsed, answers);
}

type Carried = Readonly<Record<string, string>>;

function withHeaders(answer: Answer, headers: Carried): Answer {
  if (Object.keys(headers).length === 0) {
    return answer;
  }
  const body = answer.structuredContent === undefined ? answer.content[0]?.text : answer.structuredContent;
  const structuredContent = body === undefined || body === null ? { headers } : { headers, body };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function settled(answer: Answer, observed: Observed): CallSettled {
  const { content, structuredContent } = answer;
  const kept = structuredContent === undefined ? { content } : { content, structuredContent };
  return { result: decodeToolResult(answer), resultJson: JSON.stringify(kept), observed };
}

function redirectAnswer(status: number): Answer {
  return {
    content: [
      { type: 'text', text: `The tool server answered a redirect, HTTP ${status}, which a call does not follow` },
    ],
    isError: true,
  };
}

function isAFile(response: Readonly<Response>, mediaType: string | undefined): boolean {
  return response.status < 300 && response.body !== null && !isJson(mediaType);
}

interface Shown extends ReadAsJson, Pick<Answering, 'failureCodes' | 'input' | 'assets'> {
  readonly answers: AnswerSchemas;
  readonly carried: Carried;
}

function shownOrRefused(response: Readonly<Response>, shown: Shown, observed: Observed): CallSettled {
  const { text, json, carried, failureCodes } = shown;
  const challenge = extractWWWAuthenticateParams(response);
  const refusal = refusalOf({ status: response.status, text, challenge, json }, failureCodes);
  if (refusal === undefined) {
    return settled(withHeaders(shownAnswer(response.status, shown), carried), observed);
  }
  return refusal.error === undefined ? settled(errorAnswer(text), observed) : { error: refusal.error, observed };
}

async function unreadSettled(response: Readonly<Response>, answering: Answering): Promise<CallSettled> {
  await response.body?.cancel();
  const observed = observedOf(response, answering, false);
  return failsByItsStatus(response.status)
    ? { error: new AnsweredStatus(response.status), observed }
    : settled(redirectAnswer(response.status), observed);
}

export async function settledOf(
  response: Readonly<Response>,
  answering: Answering,
  answers: AnswerSchemas = unschemedAnswers,
  file: AnsweredFile = unreadFiles,
): Promise<CallSettled> {
  if (failsByItsStatus(response.status) || isARedirect(response.status)) {
    return unreadSettled(response, answering);
  }
  const mediaType = mediaTypeOf(response);
  const carried = headersCarriedBy(response.status, response.headers, answers);
  let tooLarge = false;
  try {
    const { failureCodes, input, assets } = answering;
    const observed = observedOf(response, answering, false);
    if (isAFile(response, mediaType)) {
      const bytes = await fileBytesOf(response);
      const read = failureCodes === null ? undefined : jsonWithinTheBound(bytes);
      return read === undefined
        ? settled(withHeaders(textAnswer(await fileTextOf(response, bytes, file)), carried), observed)
        : shownOrRefused(response, { ...read, answers, carried, failureCodes, input, assets }, observed);
    }
    const text = await shownTextOf(response, () => {
      tooLarge = true;
    });
    const json = jsonOf(text, mediaType, failureCodes);
    return shownOrRefused(response, { text, json, answers, carried, failureCodes, input, assets }, observed);
  } catch (error) {
    return { error, observed: observedOf(response, answering, tooLarge || error instanceof DocumentTooLarge) };
  }
}
