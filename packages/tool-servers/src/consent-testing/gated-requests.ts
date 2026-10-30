import type { FetchLike } from '@modelcontextprotocol/client';
import { HostRefused } from '@on.auto/outbound';
import { Function, Option, Schema } from 'effect';

import type { FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { until } from '../testing/until.ts';

export interface GatedRequests {
  readonly fetch: FetchLike;
  readonly release: () => void;
  readonly holding: () => number;
  readonly answered: () => readonly string[];
}

const accessTokenOf = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ access_token: Schema.String })));

export function gatedRequests(path = '/token'): GatedRequests {
  const opened = Promise.withResolvers<void>();
  const answered: string[] = [];
  const held = { requests: 0 };
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const url = String(address);
      if (!url.endsWith(path)) {
        return globalThis.fetch(url, Object.assign({}, init));
      }
      held.requests += 1;
      await opened.promise;
      const answer = await globalThis.fetch(url, Object.assign({}, init));
      answered.push(
        ...Option.toArray(Option.map(accessTokenOf(await answer.clone().text()), (tokens) => tokens.access_token)),
      );
      return answer;
    },
    release: opened.resolve,
    holding: () => held.requests,
    answered: () => [...answered],
  };
}

export interface CuttingTimeouts {
  readonly requestTimeout: (ms: number) => AbortSignal;
  readonly cut: () => void;
  readonly cutWhen: (holds: () => boolean) => Promise<void>;
  readonly cuts: () => readonly number[];
}

export function cuttingTimeouts(): CuttingTimeouts {
  const cuts: number[] = [];
  const cutting = new AbortController();
  const cut = () => {
    cutting.abort();
  };
  return {
    requestTimeout: (ms) => {
      cuts.push(ms);
      return cutting.signal;
    },
    cut,
    cutWhen: async (holds) => {
      await until(holds);
      cut();
    },
    cuts: () => [...cuts],
  };
}

export function hostRefusedAt(path: string, rule: string): FetchLike {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address).endsWith(path)
      ? Promise.reject(new HostRefused({ rule }))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

export function failingAt(path: string): FetchLike {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    new URL(String(address)).pathname === path
      ? Promise.resolve(new Response('failing', { status: 500 }))
      : globalThis.fetch(String(address), Object.assign({}, init));
}

export interface WithdrawnMetadata {
  readonly fetch: FetchLike;
  readonly withdraw: () => void;
}

const resourceMetadataPaths: ReadonlySet<string> = new Set([
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource',
]);

function withdrawnAnswerTo(address: string, server: string): Response | undefined {
  if (address === server) {
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return resourceMetadataPaths.has(new URL(address).pathname) ? new Response(null, { status: 404 }) : undefined;
}

export function metadataWithdrawnFrom(server: string): WithdrawnMetadata {
  const state = { withdrawn: false };
  return {
    fetch: (...[address, init]: readonly [unknown, unknown?]) => {
      const withdrawn = state.withdrawn ? withdrawnAnswerTo(String(address), server) : undefined;
      return withdrawn === undefined
        ? globalThis.fetch(String(address), Object.assign({}, init))
        : Promise.resolve(withdrawn);
    },
    withdraw: () => {
      state.withdrawn = true;
    },
  };
}

export interface RecordedFetch {
  readonly fetch: FetchLike;
  readonly asked: () => readonly string[];
}

export function recordedFetch(
  answeredHere: (address: string) => Response | undefined = Function.constUndefined,
): RecordedFetch {
  const asked: string[] = [];
  return {
    fetch: (...[address, init]: readonly [unknown, unknown?]) => {
      asked.push(String(address));
      const here = answeredHere(String(address));
      return here === undefined ? globalThis.fetch(String(address), Object.assign({}, init)) : Promise.resolve(here);
    },
    asked: () => [...asked],
  };
}

export function pingAnsweredWith(
  server: string,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): RecordedFetch {
  return recordedFetch((address) => (address === server ? new Response(null, { status, headers }) : undefined));
}

export function challengedWith(server: string, challenge: string): RecordedFetch {
  return pingAnsweredWith(server, 401, { 'www-authenticate': challenge });
}

export function brokenAtTheChallenge({ url, origin }: FakeMcpServer): RecordedFetch {
  const broken = `${origin}/metadata/broken`;
  return recordedFetch((address) => {
    if (address === url) {
      return new Response(null, {
        status: 401,
        headers: { 'www-authenticate': `Bearer resource_metadata="${broken}"` },
      });
    }
    return address === broken ? new Response('failing', { status: 500 }) : undefined;
  });
}
