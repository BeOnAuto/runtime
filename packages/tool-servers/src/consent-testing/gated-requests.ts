import type { FetchLike } from '@modelcontextprotocol/client';
import { HostRefused } from '@on.auto/outbound';
import { Option, Schema } from 'effect';

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
