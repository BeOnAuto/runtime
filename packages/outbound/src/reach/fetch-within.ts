import { Data } from 'effect';

import type { OutboundFetch } from '../user-agent/user-agent-fetch.ts';

export type Reaches = (url: string) => string | undefined | Promise<string | undefined>;

export class HostRefused extends Data.TaggedError('host_refused')<{ readonly rule: string }> {}

type Sending = (url: string, init: Readonly<{ redirect: 'manual' }>) => Promise<Response>;

const unfollowed = { redirect: 'manual' } as const;

export function fetchWithin(fetch: Sending, reaches: Reaches): OutboundFetch {
  return async (...[url, init]: readonly [unknown, unknown?]) => {
    const address = String(url);
    const refusal = await reaches(address);
    if (refusal !== undefined) {
      throw new HostRefused({ rule: refusal });
    }
    return fetch(address, Object.assign({}, init, unfollowed));
  };
}
