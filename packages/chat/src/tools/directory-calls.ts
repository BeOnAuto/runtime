import type { ToolDefinition } from '@on.auto/reasoning';
import { Option, Schema } from 'effect';

import {
  answerReadWithin,
  isErrorOfACutAnswer,
  RESULT_BOUNDS,
  textOfACutAnswer,
  textWithinTheBound,
  type ResultBounds,
} from './bounded-answer.ts';

export interface ToolReply {
  readonly text: string;
  readonly isError: boolean;
}

export type SendToDirectory = (request: Readonly<Request>) => Promise<Response>;

export interface DirectoryCalls {
  readonly tools: (signal?: Readonly<AbortSignal>) => Promise<readonly ToolDefinition[]>;
  readonly call: (
    name: string,
    input: Readonly<Record<string, unknown>>,
    signal?: Readonly<AbortSignal>,
  ) => Promise<ToolReply>;
}

const ListingSchema = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optionalKey(Schema.String),
      inputSchema: Schema.JsonObject,
    }),
  ),
});

const CalledSchema = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })),
  isError: Schema.optionalKey(Schema.Boolean),
});

const listingRead = Schema.decodeUnknownOption(ListingSchema);

const calledRead = Schema.decodeUnknownOption(CalledSchema);

export const NOT_LISTED = 'The directory did not list its tools';

export const NOT_ANSWERED = 'The tool did not answer';

export const ANSWERED_NOTHING = 'The tool answered nothing';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function jsonIn(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

function dataOf(event: string): string {
  return event
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
}

function answersIn(text: string): readonly unknown[] {
  const whole = text.trim();
  if (whole.startsWith('{') || whole.startsWith('[')) {
    const answered = jsonIn(whole);
    return Array.isArray(answered) ? answered : [answered];
  }
  return text.split(/\r?\n\r?\n/u).flatMap((event) => {
    const data = dataOf(event);
    return data === '' ? [] : [jsonIn(data)];
  });
}

const answerIn = (text: string, id: string): unknown =>
  answersIn(text).find((answered) => isRecord(answered) && answered['id'] === id);

function resultOf(answer: unknown): unknown {
  return isRecord(answer) ? answer['result'] : undefined;
}

function errorWordsOf(answer: unknown, mostBytes: number): string | undefined {
  const error = isRecord(answer) ? answer['error'] : undefined;
  return isRecord(error) && typeof error['message'] === 'string'
    ? textWithinTheBound(error['message'], mostBytes)
    : undefined;
}

async function problemDetailOf(response: Readonly<Response>, bounds: ResultBounds): Promise<string> {
  const read = await answerReadWithin(response, bounds.answerBytesRead);
  const problem = read.cut ? undefined : jsonIn(read.text);
  return isRecord(problem) && typeof problem['detail'] === 'string'
    ? textWithinTheBound(problem['detail'], bounds.resultBytes)
    : NOT_ANSWERED;
}

interface Asked {
  readonly id: string;
  readonly request: Request;
}

function askedOf(directoryUrl: string, method: string, params: object, signal?: Readonly<AbortSignal>): Asked {
  const id = crypto.randomUUID();
  const request = new Request(directoryUrl, {
    method: 'POST',
    ...(signal === undefined ? {} : { signal }),
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { id, request };
}

function replyOf(answer: unknown, bounds: ResultBounds): ToolReply {
  const called = calledRead(resultOf(answer));
  if (Option.isNone(called)) {
    return { text: errorWordsOf(answer, bounds.resultBytes) ?? NOT_ANSWERED, isError: true };
  }
  const text = called.value.content
    .flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : []))
    .join('\n');
  return {
    text: text === '' ? ANSWERED_NOTHING : textWithinTheBound(text, bounds.resultBytes),
    isError: called.value.isError === true,
  };
}

export function directoryCallsOf(
  directoryUrl: string,
  send: SendToDirectory,
  given: Partial<ResultBounds> = {},
): DirectoryCalls {
  const bounds: ResultBounds = { ...RESULT_BOUNDS, ...given };
  return {
    tools: async (signal) => {
      const { id, request } = askedOf(directoryUrl, 'tools/list', {}, signal);
      const response = await send(request);
      if (!response.ok) {
        throw new Error(NOT_LISTED);
      }
      const read = await answerReadWithin(response, bounds.answerBytesRead);
      if (read.cut) {
        throw new Error(NOT_LISTED);
      }
      const listing = listingRead(resultOf(answerIn(read.text, id)));
      if (Option.isNone(listing)) {
        throw new Error(NOT_LISTED);
      }
      return listing.value.tools.map(({ name, description = '', inputSchema }) => ({ name, description, inputSchema }));
    },
    call: async (name, input, signal) => {
      const { id, request } = askedOf(directoryUrl, 'tools/call', { name, arguments: input }, signal);
      const response = await send(request);
      if (!response.ok) {
        return { text: await problemDetailOf(response, bounds), isError: true };
      }
      const read = await answerReadWithin(response, bounds.answerBytesRead);
      if (read.cut) {
        return {
          text: textOfACutAnswer(read.text, bounds.resultBytes),
          isError: isErrorOfACutAnswer(read.text),
        };
      }
      return replyOf(answerIn(read.text, id), bounds);
    },
  };
}
