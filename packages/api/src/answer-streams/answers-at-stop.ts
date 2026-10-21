import {
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type RequestId,
} from '@modelcontextprotocol/server';
import { Function } from 'effect';

export const stoppedWords =
  'Auto Runtime stopped while it handled this request, so it may or may not have taken effect';

const internalError = -32_603;

const eventStream = 'text/event-stream';

const encoder = new TextEncoder();

type Controller = Readonly<TransformStreamDefaultController<Uint8Array>>;

interface InFlight {
  readonly body: ReadableStream<Uint8Array>;
  readonly stopped: () => void;
}

interface Unanswered {
  readonly heard: (piece: Readonly<Uint8Array>) => void;
  readonly left: () => readonly RequestId[];
}

function stoppedAnswerTo(id: RequestId): Uint8Array {
  const answer = { jsonrpc: '2.0', id, error: { code: internalError, message: stoppedWords } };
  return encoder.encode(`event: message\ndata: ${JSON.stringify(answer)}\n\n`);
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function answeredIn(event: string): readonly RequestId[] {
  const data = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
  const message = parsed(data);
  const answered = isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message) ? message.id : undefined;
  return answered === undefined ? [] : [answered];
}

function unansweredOf(asked: readonly RequestId[]): Unanswered {
  const unanswered = new Set(asked);
  const decoder = new TextDecoder();
  const pending = { text: '' };
  return {
    heard: (piece) => {
      const events = `${pending.text}${decoder.decode(piece, { stream: true })}`.split('\n\n');
      pending.text = events.splice(-1).join('');
      for (const id of events.flatMap((event) => answeredIn(event))) {
        unanswered.delete(id);
      }
    },
    left: () => [...unanswered],
  };
}

function inFlightOf(asked: readonly RequestId[], source: ReadableStream<Uint8Array>, settled: () => void): InFlight {
  const unanswered = unansweredOf(asked);
  const stopping = { stop: Function.constVoid };
  const body = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start: (controller: Controller) => {
        stopping.stop = () => {
          for (const id of unanswered.left()) {
            controller.enqueue(stoppedAnswerTo(id));
          }
          controller.terminate();
        };
      },
      transform: (piece: Readonly<Uint8Array>, controller: Controller) => {
        unanswered.heard(piece);
        controller.enqueue(piece);
      },
      flush: settled,
      cancel: settled,
    }),
  );
  return {
    body,
    stopped: () => {
      stopping.stop();
    },
  };
}

export function requestIdsIn(messages: readonly unknown[]): readonly RequestId[] {
  return messages.flatMap((message) => (isJSONRPCRequest(message) ? [message.id] : []));
}

function isEventStream(answer: Readonly<Response>): boolean {
  return answer.headers.get('content-type')?.startsWith(eventStream) === true;
}

export class AnswersAtStop {
  readonly #inFlight = new Set<InFlight>();
  #stopped = false;

  hasStopped(): boolean {
    return this.#stopped;
  }

  answering(asked: readonly RequestId[], answer: Response): Response {
    if (asked.length === 0 || answer.body === null || !isEventStream(answer)) {
      return answer;
    }
    const inFlight = inFlightOf(asked, answer.body, () => {
      this.#inFlight.delete(inFlight);
    });
    if (this.#stopped) {
      inFlight.stopped();
    } else {
      this.#inFlight.add(inFlight);
    }
    return new Response(inFlight.body, {
      status: answer.status,
      statusText: answer.statusText,
      headers: answer.headers,
    });
  }

  stop(): void {
    this.#stopped = true;
    for (const inFlight of this.#inFlight) {
      inFlight.stopped();
    }
    this.#inFlight.clear();
  }
}
