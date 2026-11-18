import type { FetchOfACall } from '@on.auto/operations';
import { Array as Arr, Option } from 'effect';

import type { TokenSource } from '../clients/token-source.ts';

interface SentRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly redirect: string;
}

type Answer = (request: Readonly<Request>) => Response | Promise<Response>;

export interface AnsweringService {
  readonly fetch: FetchOfACall;
  readonly sent: () => readonly SentRequest[];
}

function inTurn<A>(items: readonly A[], index: number): A {
  return Option.getOrThrow(Arr.get(items, Math.min(index, items.length - 1)));
}

export function answeringService(first: Answer, ...more: readonly Answer[]): AnsweringService {
  const answers = [first, ...more];
  const sent: SentRequest[] = [];
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const request = new Request(String(address), Object.assign({}, init));
      const { url, method, redirect } = request;
      const headers = Object.fromEntries(request.headers);
      sent.push({ url, method, headers, body: await request.clone().text(), redirect });
      return inTurn(answers, sent.length - 1)(request);
    },
    sent: () => [...sent],
  };
}

export function answeredJson(status: number, body: unknown): Answer {
  return () => Response.json(body, { status });
}

export function answeredEmpty(status: number, headers: Readonly<Record<string, string>> = {}): Answer {
  return () => new Response(null, { status, headers });
}

interface TokensInTurn extends TokenSource {
  readonly asked: () => number;
  readonly renewals: () => number;
}

export function heldTokens(first: string, ...renewed: readonly string[]): TokensInTurn {
  const tokens = [first, ...renewed];
  let asked = 0;
  let renewals = 0;
  return {
    token: () => {
      asked += 1;
      return Promise.resolve(inTurn(tokens, renewals));
    },
    onUnauthorized: () => {
      renewals += 1;
      return Promise.resolve();
    },
    asked: () => asked,
    renewals: () => renewals,
  };
}
