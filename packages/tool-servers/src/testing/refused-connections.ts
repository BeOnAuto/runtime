import type { FetchLike } from '@modelcontextprotocol/client';

import { inProcessFetch } from './in-process.ts';

export interface RefusedConnections {
  readonly fetch: typeof globalThis.fetch;
  readonly refuse: (origin: string) => void;
}

function refusedConnectionTo(address: string): TypeError {
  const { hostname, port } = new URL(address);
  const refused = Object.assign(new Error(`connect ECONNREFUSED ${hostname}:${port}`), {
    code: 'ECONNREFUSED',
    syscall: 'connect',
  });
  return new TypeError('fetch failed', { cause: refused });
}

export function refusedConnections(
  origins: readonly string[] = [],
  passedOn: FetchLike = inProcessFetch,
): RefusedConnections {
  const refused = new Set(origins);
  return {
    fetch: (...[address, init]: readonly [unknown, unknown?]) =>
      refused.has(new URL(String(address)).origin)
        ? Promise.reject(refusedConnectionTo(String(address)))
        : passedOn(String(address), Object.assign({}, init)),
    refuse: (origin) => {
      refused.add(origin);
    },
  };
}
