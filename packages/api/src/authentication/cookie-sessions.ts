import type { Principal } from '@on.auto/identity';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

import type { ApiEnv } from '../api-env.ts';

export const sessionCookie = 'session';

const antiForgeryHeaderName = 'x-csrf';

const antiForgeryHeaderValue = '1';

export interface CookieSessions {
  readonly principalOf: (identifier: string) => Promise<Principal | undefined>;
}

function sessionPresentedIn(c: Context<ApiEnv>): string | undefined {
  return c.req.header(antiForgeryHeaderName) === antiForgeryHeaderValue
    ? getCookie(c, sessionCookie, 'host')
    : undefined;
}

export function sessionHolderOf(c: Context<ApiEnv>, sessions: CookieSessions): Promise<Principal | undefined> {
  const identifier = sessionPresentedIn(c);
  return identifier === undefined ? Promise.resolve(identifier) : sessions.principalOf(identifier);
}
