import { Data } from 'effect';

export type Reaches = (url: string) => string | undefined | Promise<string | undefined>;

export class HostRefused extends Data.TaggedError('host_refused')<{ readonly rule: string }> {}

type Sending<Beside extends readonly unknown[]> = (
  url: string,
  init: Readonly<{ redirect: 'manual' }>,
  ...beside: Beside
) => Promise<Response>;

type HeldWithin<Beside extends readonly unknown[]> = (
  url: unknown,
  init?: unknown,
  ...beside: Beside
) => Promise<Response>;

const unfollowed = { redirect: 'manual' } as const;

export function fetchWithin<Beside extends readonly unknown[]>(
  fetch: Sending<Beside>,
  reaches: Reaches,
): HeldWithin<Beside> {
  return async (url, init, ...beside) => {
    const address = String(url);
    const refusal = await reaches(address);
    if (refusal !== undefined) {
      throw new HostRefused({ rule: refusal });
    }
    return fetch(address, Object.assign({}, init, unfollowed), ...beside);
  };
}
