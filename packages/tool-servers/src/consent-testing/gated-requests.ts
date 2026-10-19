import type { FetchLike } from '@modelcontextprotocol/client';
import { Option, Schema } from 'effect';

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
