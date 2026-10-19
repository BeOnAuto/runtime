import type { StudioAnswer } from '@on.auto/api';
import { Function, Schema } from 'effect';

import { keptAnswersIn, type KeptAnswers } from '../../studio/kept-answers.ts';
import { studioBounds, studioHostOf, type StudioBounds } from '../../studio/studio-host.ts';

export const scriptedOrigin = 'https://studio.example.com';

export const modified = 'Mon, 19 Oct 2026 08:00:00 GMT';

const startedAt = Date.parse('2026-10-19T09:00:00Z');

interface Asked {
  readonly url: string;
  readonly validators: readonly (string | null)[];
}

export type Answering = (path: string) => Response | Promise<Response>;

export interface ScriptedHost {
  readonly ask: (path: string) => Promise<StudioAnswer | undefined>;
  readonly asked: () => readonly Asked[];
  readonly answerWith: (answering: Answering) => void;
  readonly passSeconds: (seconds: number) => void;
}

interface Scripting {
  readonly bounds?: StudioBounds;
  readonly kept?: KeptAnswers;
  readonly hostOrigin?: string;
}

const SentSchema = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  signal: Schema.instanceOf(AbortSignal),
});

function answeredWithin(answer: Response | Promise<Response>, signal: Readonly<AbortSignal>): Promise<Response> {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(new Error('The call was aborted'));
    });
    Promise.resolve(answer).then(resolve, reject);
  });
}

export function memoryKept(): KeptAnswers {
  return keptAnswersIn(undefined, { mostBytes: 1_048_576, report: Function.constVoid });
}

export function scriptedHost(
  first: Answering,
  { bounds = studioBounds, kept = memoryKept(), hostOrigin = scriptedOrigin }: Scripting = {},
): ScriptedHost {
  const asked: Asked[] = [];
  const clock = { now: startedAt, answering: first };
  const fetch = (url: unknown, init?: unknown): Promise<Response> => {
    const sent = Schema.decodeUnknownSync(SentSchema)(init);
    const headers = new Headers(sent.headers);
    asked.push({ url: String(url), validators: [headers.get('if-none-match'), headers.get('if-modified-since')] });
    return answeredWithin(clock.answering(new URL(String(url)).pathname), sent.signal);
  };
  const host = studioHostOf({ origin: hostOrigin, fetch, kept, bounds, now: () => clock.now });
  return {
    ask: host,
    asked: () => [...asked],
    answerWith: (answering) => {
      clock.answering = answering;
    },
    passSeconds: (seconds) => {
      clock.now += seconds * 1000;
    },
  };
}

export function textOf(answer: StudioAnswer | undefined): string {
  return new TextDecoder().decode(answer?.body);
}

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function unreachable(): Promise<Response> {
  return Promise.reject(new TypeError('fetch failed'));
}

export function page(body: string, etag: string): Answering {
  return () =>
    new Response(body, {
      headers: {
        'content-type': 'text/html',
        'cache-control': 'public, max-age=0, must-revalidate',
        etag,
        'last-modified': modified,
      },
    });
}

export function answered(status: number, headers: Readonly<Record<string, string>> = {}): Answering {
  return () => new Response(null, { status, headers });
}
