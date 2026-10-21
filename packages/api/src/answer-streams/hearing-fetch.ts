import type { RequestId } from '@modelcontextprotocol/server';
import { Option, Predicate, Schema } from 'effect';

export interface HeardAnswer {
  readonly piece: (piece: Readonly<Uint8Array>) => void;
  readonly ended: () => void;
}

export type AnswerHearing = (asked: RequestId) => HeardAnswer;

const RequestSchema = Schema.Struct({ id: Schema.Union([Schema.String, Schema.Number]), method: Schema.String });

const requestOf = Schema.decodeUnknownOption(Schema.fromJsonString(RequestSchema));

function requestIdIn(asked: unknown): RequestId | undefined {
  const body: unknown = Predicate.hasProperty(asked, 'body') ? asked.body : undefined;
  return Option.getOrUndefined(Option.map(requestOf(body), ({ id }) => id));
}

function heardEachPieceOf(answer: Readonly<Response>, heard: HeardAnswer): Response {
  const body = answer.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform: (piece: Readonly<Uint8Array>, controller: Readonly<TransformStreamDefaultController<Uint8Array>>) => {
        heard.piece(piece);
        controller.enqueue(piece);
      },
      flush: () => {
        heard.ended();
      },
    }),
  );
  return new Response(body, { status: answer.status, statusText: answer.statusText, headers: answer.headers });
}

export function hearingFetch<Args extends readonly [unknown, unknown?]>(
  fetching: (...args: Args) => Promise<Response>,
  hearing: AnswerHearing,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const [, asked] = args;
    const id = requestIdIn(asked);
    const answer = await fetching(...args);
    return id === undefined ? answer : heardEachPieceOf(answer, hearing(id));
  };
}
