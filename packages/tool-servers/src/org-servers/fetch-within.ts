import type { FetchLike } from '@modelcontextprotocol/client';

import { HostRefused } from '../clients/server-failures.ts';

export type Reaches = (url: string) => string | undefined;

const unfollowed = { redirect: 'manual' } as const;

export function fetchWithin(fetch: FetchLike, reaches: Reaches): FetchLike {
  return (...[url, init]: readonly [unknown, unknown?]) => {
    const address = String(url);
    const refusal = reaches(address);
    return refusal === undefined
      ? fetch(address, Object.assign({}, init, unfollowed))
      : Promise.reject(new HostRefused({ rule: refusal }));
  };
}
