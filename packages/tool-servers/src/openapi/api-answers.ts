import { toolBounds } from '../bounds/call-bounds.ts';
import { decodeToolResult } from '../bounds/tool-results.ts';
import { counted, retryAfterMsOf, type Observed } from '../clients/observed-requests.ts';
import type { CallSettled } from '../clients/server-client.ts';
import { AnsweredStatus } from './answered-status.ts';

export interface Answering {
  readonly requestIdHeader: string | null;
  readonly now: () => number;
}

interface ContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly mimeType?: string;
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

function isShown(mediaType: string | undefined): boolean {
  return mediaType !== undefined && (jsonMediaType.test(mediaType) || mediaType.startsWith('text/'));
}

function parsedJson(text: string): { readonly parsed: unknown } | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return { parsed };
  } catch {
    return undefined;
  }
}

function shownAnswer(status: number, mediaType: string | undefined, text: string): Answer {
  if (status >= 300) {
    return {
      content: [{ type: 'text', text: text === '' ? `The tool server answered HTTP ${status}` : text }],
      isError: true,
    };
  }
  if (text === '') {
    return { content: [] };
  }
  const json = mediaType !== undefined && jsonMediaType.test(mediaType) ? parsedJson(text) : undefined;
  return json === undefined
    ? { content: [{ type: 'text', text }] }
    : { content: [{ type: 'text', text }], structuredContent: json.parsed };
}

function settled(answer: Answer, observed: Observed): CallSettled {
  const { content, structuredContent } = answer;
  const kept = structuredContent === undefined ? { content } : { content, structuredContent };
  return { result: decodeToolResult(answer), resultJson: JSON.stringify(kept), observed };
}

function unreadAnswer(status: number, mediaType: string | undefined): Answer {
  return redirected(status)
    ? {
        content: [
          { type: 'text', text: `The tool server answered a redirect, HTTP ${status}, which a call does not follow` },
        ],
        isError: true,
      }
    : { content: [{ type: 'binary', ...(mediaType === undefined ? {} : { mimeType: mediaType }) }] };
}

function leftUnread(status: number, mediaType: string | undefined, hasBody: boolean): boolean {
  return failed(status) || redirected(status) || (status < 300 && !isShown(mediaType) && hasBody);
}

export async function settledOf(response: Readonly<Response>, answering: Answering): Promise<CallSettled> {
  const mediaType = mediaTypeOf(response);
  if (leftUnread(response.status, mediaType, response.body !== null)) {
    await response.body?.cancel();
    const observed = observedOf(response, answering, false);
    return failed(response.status)
      ? { error: new AnsweredStatus(response.status), observed }
      : settled(unreadAnswer(response.status, mediaType), observed);
  }
  let tooLarge = false;
  try {
    const text = await counted(response, toolBounds.httpAnswerBytes, () => {
      tooLarge = true;
    }).text();
    return settled(shownAnswer(response.status, mediaType, text), observedOf(response, answering, false));
  } catch (error) {
    return { error, observed: observedOf(response, answering, tooLarge) };
  }
}
