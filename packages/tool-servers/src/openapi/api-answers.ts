import { extractWWWAuthenticateParams } from '@modelcontextprotocol/client';

import { decodeToolResult } from '../bounds/tool-results.ts';
import { retryAfterMsOf, type Observed } from '../clients/observed-requests.ts';
import type { CallSettled } from '../clients/server-client.ts';
import { fileTextOf, shownTextOf, unreadFiles, type AnsweredFile } from './answer-bodies.ts';
import { AnsweredStatus } from './answered-status.ts';
import { unschemedAnswers, type AnswerSchemas } from './api-parameters.ts';
import { decodedAnswer } from './byte-strings.ts';
import { DocumentTooLarge } from './document-too-large.ts';
import { ScopeLacking, scopeLackingIn } from './scope-lacking.ts';

export interface Answering {
  readonly requestIdHeader: string | null;
  readonly now: () => number;
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

function failed(status: number): boolean {
  return status === 401 || status === 429 || status >= 500;
}

function redirected(status: number): boolean {
  return status >= 300 && status < 400;
}

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
  const decoded = decodedAnswer(parsed, answers);
  return {
    content: [{ type: 'text', text: decoded === parsed ? text : JSON.stringify(decoded) }],
    structuredContent: decoded,
  };
}

function textAnswer(text: string): Answer {
  return text === '' ? { content: [] } : { content: [{ type: 'text', text }] };
}

function shownAnswer(status: number, mediaType: string | undefined, text: string, answers: AnswerSchemas): Answer {
  if (status >= 300) {
    return {
      content: [{ type: 'text', text: text === '' ? `The tool server answered HTTP ${status}` : text }],
      isError: true,
    };
  }
  const json = isJson(mediaType) ? parsedJson(text) : undefined;
  return json === undefined ? textAnswer(text) : jsonAnswer(text, json.parsed, answers);
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

interface Shown {
  readonly mediaType: string | undefined;
  readonly text: string;
  readonly answers: AnswerSchemas;
}

function shownOrRefused(
  response: Readonly<Response>,
  { mediaType, text, answers }: Shown,
  observed: Observed,
): CallSettled {
  const { error, scope } = extractWWWAuthenticateParams(response);
  const lacking = scopeLackingIn({ status: response.status, body: text, error, scope });
  return lacking === undefined
    ? settled(shownAnswer(response.status, mediaType, text, answers), observed)
    : { error: new ScopeLacking(lacking), observed };
}

async function unreadSettled(response: Readonly<Response>, answering: Answering): Promise<CallSettled> {
  await response.body?.cancel();
  const observed = observedOf(response, answering, false);
  return failed(response.status)
    ? { error: new AnsweredStatus(response.status), observed }
    : settled(redirectAnswer(response.status), observed);
}

export async function settledOf(
  response: Readonly<Response>,
  answering: Answering,
  answers: AnswerSchemas = unschemedAnswers,
  file: AnsweredFile = unreadFiles,
): Promise<CallSettled> {
  if (failed(response.status) || redirected(response.status)) {
    return unreadSettled(response, answering);
  }
  const mediaType = mediaTypeOf(response);
  let tooLarge = false;
  try {
    if (isAFile(response, mediaType)) {
      const text = await fileTextOf(response, file);
      return settled(textAnswer(text), observedOf(response, answering, false));
    }
    const text = await shownTextOf(response, () => {
      tooLarge = true;
    });
    return shownOrRefused(response, { mediaType, text, answers }, observedOf(response, answering, false));
  } catch (error) {
    return { error, observed: observedOf(response, answering, tooLarge || error instanceof DocumentTooLarge) };
  }
}
