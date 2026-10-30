import { boundedAnswerOf } from '@on.auto/outbound';
import { Option, Schema } from 'effect';

import { headerNamePattern } from '../settings/checked.ts';
import { ignored } from './ignored.ts';

type RequestId = string | number;

type Marker = (resumptionToken: string) => void;

interface ObservedResponse {
  readonly retryAfterMs: number | null;
  readonly serverRequestId: string | null;
  readonly tooLarge: boolean;
}

export interface SendOptions {
  readonly onresumptiontoken?: ((token: string) => void) | undefined;
}

export interface Observed {
  readonly id: RequestId | null;
  readonly response: ObservedResponse | null;
}

export interface Observations {
  readonly mark: () => Marker;
  readonly noteSent: (message: unknown, options: Readonly<SendOptions> | undefined) => void;
  readonly noteAnswered: (body: unknown, response: Readonly<Response>) => Response;
  readonly whenTooLarge: (marker: Marker, stop: () => void) => void;
  readonly noteOverflow: () => void;
  readonly take: (marker: Marker) => Observed;
  readonly lastRetryAfterMs: () => number | null;
}

const MessageSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.optionalKey(Schema.String),
});

const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(MessageSchema));

const decodeMessage = Schema.decodeUnknownOption(MessageSchema);

function idIn(body: unknown): RequestId | undefined {
  return typeof body === 'string' ? decodeBody(body).id : undefined;
}

function requestIdOf(message: unknown): RequestId | undefined {
  const decoded = Option.getOrUndefined(decodeMessage(message));
  return decoded?.method === undefined ? undefined : decoded.id;
}

const delaySeconds = /^\d+$/u;

const mostRetryAfterMs = 86_400_000;

const httpDate = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u;

export function retryAfterMsOf(value: string | null, now: number): number | null {
  const given = value?.trim() ?? '';
  if (delaySeconds.test(given)) {
    return Math.min(Number(given) * 1000, mostRetryAfterMs);
  }
  const date = httpDate.test(given) ? Date.parse(given) : Number.NaN;
  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - now), mostRetryAfterMs);
}

type Observing = (response: Readonly<Response>, requestIdHeader: string | null) => ObservedResponse;

const unanswered: ObservedResponse = { retryAfterMs: null, serverRequestId: null, tooLarge: false };

const observedOf: Observing = (response, requestIdHeader) => ({
  retryAfterMs: retryAfterMsOf(response.headers.get('retry-after'), Date.now()),
  serverRequestId: requestIdHeader === null ? null : response.headers.get(requestIdHeader),
  tooLarge: false,
});

type StopOf = (id: RequestId) => (() => void) | undefined;

function stopsOf(sent: ReadonlyMap<Marker, RequestId>, stops: ReadonlyMap<Marker, () => void>): StopOf {
  return (id) =>
    [...sent]
      .flatMap(([marker, sentId]: readonly [Marker, RequestId]) => (sentId === id ? [stops.get(marker)] : []))
      .at(0);
}

function overflowOf(answered: Map<RequestId, ObservedResponse | null>, stopOf: StopOf): () => void {
  return () => {
    for (const [id, observed] of answered) {
      answered.set(id, { ...(observed ?? unanswered), tooLarge: true });
      stopOf(id)?.();
    }
  };
}

export function observations(requestId: string | null, mostAnswerBytes: number): Observations {
  const requestIdHeader = requestId !== null && headerNamePattern.test(requestId) ? requestId : null;
  const sent = new Map<Marker, RequestId>();
  const answered = new Map<RequestId, ObservedResponse | null>();
  const stops = new Map<Marker, () => void>();
  const latest: { retryAfterMs: number | null } = { retryAfterMs: null };
  const stopOf = stopsOf(sent, stops);
  return {
    mark: () => ignored.bind(null),
    noteSent: (message, options) => {
      const marker = options?.onresumptiontoken;
      const id = requestIdOf(message);
      if (marker !== undefined && id !== undefined) {
        sent.set(marker, id);
        answered.set(id, null);
      }
    },
    noteAnswered: (body, response) => {
      const observed = observedOf(response, requestIdHeader);
      latest.retryAfterMs = observed.retryAfterMs;
      const id = idIn(body);
      if (id === undefined || !answered.has(id)) {
        return boundedAnswerOf(response, mostAnswerBytes, ignored);
      }
      answered.set(id, observed);
      return boundedAnswerOf(response, mostAnswerBytes, () => {
        answered.set(id, { ...observed, tooLarge: true });
        stopOf(id)?.();
      });
    },
    whenTooLarge: (marker, stop) => {
      stops.set(marker, stop);
    },
    noteOverflow: overflowOf(answered, stopOf),
    take: (marker) => {
      const id = sent.get(marker);
      sent.delete(marker);
      stops.delete(marker);
      if (id === undefined) {
        return { id: null, response: null };
      }
      const response = answered.get(id) ?? null;
      answered.delete(id);
      return { id, response };
    },
    lastRetryAfterMs: () => latest.retryAfterMs,
  };
}
