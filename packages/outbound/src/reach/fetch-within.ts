import { Data } from 'effect';

import type { OutboundFetch } from '../user-agent/user-agent-fetch.ts';

export type Reaches = (url: string) => string | undefined;

export class HostRefused extends Data.TaggedError('host_refused')<{ readonly rule: string }> {}

type Sending = (url: string, init: Readonly<{ redirect: 'manual' }>) => Promise<Response>;

const unfollowed = { redirect: 'manual' } as const;

export function fetchWithin(fetch: Sending, reaches: Reaches): OutboundFetch {
  return (...[url, init]: readonly [unknown, unknown?]) => {
    const address = String(url);
    const refusal = reaches(address);
    return refusal === undefined
      ? fetch(address, Object.assign({}, init, unfollowed))
      : Promise.reject(new HostRefused({ rule: refusal }));
  };
}
