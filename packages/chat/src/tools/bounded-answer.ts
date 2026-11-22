import { Schema } from 'effect';

export const MOST_RESULT_BYTES = 64 * 1024;

export const MOST_ANSWER_BYTES_READ = MOST_RESULT_BYTES * 4;

export interface ResultBounds {
  readonly resultBytes: number;
  readonly answerBytesRead: number;
}

export const RESULT_BOUNDS: ResultBounds = { resultBytes: MOST_RESULT_BYTES, answerBytesRead: MOST_ANSWER_BYTES_READ };

export const resultCut = (mostBytes: number): string =>
  `This result was longer than ${mostBytes / 1024} KiB, so it ends here. Ask for less: name the one item you need, narrow the question, or ask for a shorter page or fewer fields.`;

export const RESULT_CUT = resultCut(MOST_RESULT_BYTES);

export const RESULT_TOO_LONG = `This result was too long to be given at all. Ask for less: name the one item you need, narrow the question, or ask for a shorter page or fewer fields.`;

export interface AnswerRead {
  readonly text: string;
  readonly cut: boolean;
}

const TEXT_PART = /"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*"/u;

const ERROR_WORDS_PART = /"error"\s*:\s*\{[^{}]*?"message"\s*:\s*"/u;

const MARKED_AS_AN_ERROR = /"isError"\s*:\s*true|"error"\s*:\s*\{/u;

const COMPLETE_STRING_CHARACTERS = /^((?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*)[\s\S]*$/u;

const stringIn = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.String));

const encoder = new TextEncoder();

const decoder = new TextDecoder();

type Controller = Readonly<TransformStreamDefaultController<Uint8Array>>;

function cutAfter(most: number) {
  const state = { sent: 0, cut: false };
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk: Readonly<Uint8Array>, controller: Controller) => {
      const room = most - state.sent;
      if (chunk.byteLength <= room) {
        state.sent += chunk.byteLength;
        controller.enqueue(chunk);
        return;
      }
      state.cut = true;
      state.sent = most;
      if (room > 0) {
        controller.enqueue(chunk.subarray(0, room));
      }
      controller.terminate();
    },
  });
  return { state, transform };
}

export async function answerReadWithin(
  response: Readonly<Response>,
  most = MOST_ANSWER_BYTES_READ,
): Promise<AnswerRead> {
  if (response.body === null) {
    return { text: '', cut: false };
  }
  const { state, transform } = cutAfter(most);
  const bytes = await new Response(response.body.pipeThrough(transform)).arrayBuffer();
  return { text: decoder.decode(bytes), cut: state.cut };
}

function firstBytesOf(text: string, most: number): string {
  return decoder.decode(encoder.encode(text).subarray(0, most)).replace(/�+$/u, '');
}

export function textWithinTheBound(text: string, most = MOST_RESULT_BYTES): string {
  return encoder.encode(text).byteLength <= most ? text : `${firstBytesOf(text, most)}\n\n${resultCut(most)}`;
}

export const isErrorOfACutAnswer = (answer: string): boolean => MARKED_AS_AN_ERROR.test(answer);

export function textOfACutAnswer(answer: string, most = MOST_RESULT_BYTES): string {
  const start = TEXT_PART.exec(answer) ?? ERROR_WORDS_PART.exec(answer);
  if (start === null) {
    return RESULT_TOO_LONG;
  }
  const complete = answer.slice(start.index + start[0].length).replace(COMPLETE_STRING_CHARACTERS, '$1');
  try {
    return `${firstBytesOf(stringIn(`"${complete}"`), most)}\n\n${resultCut(most)}`;
  } catch {
    return RESULT_TOO_LONG;
  }
}
