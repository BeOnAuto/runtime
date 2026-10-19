import { pageOriginsOf, type PageSettings, type ProtectedResource } from '@on.auto/identity';
import type { Context, MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { publicOriginOf } from '../discovery/public-addresses.ts';

const allowedMethods = 'GET, HEAD, POST, PUT, DELETE';

const allowedHeaders = 'authorization, content-type, traceparent, tracestate, baggage';

const exposedHeaders = 'x-request-id, x-trace-id, www-authenticate, date';

const preflightCacheSeconds = '600';

type PageOriginsOf = (c: Context<ApiEnv>) => readonly string[];

function privateNetworkOf(asked: string | undefined): Readonly<Record<string, string>> {
  return asked === 'true' ? { 'access-control-allow-private-network': 'true' } : {};
}

function answerPreflight(pageOrigins: PageOriginsOf): MiddlewareHandler<ApiEnv> {
  return (c, next) => {
    const origin = c.req.header('origin') ?? '';
    const isPreflight = c.req.method === 'OPTIONS' && c.req.header('access-control-request-method') !== undefined;
    return isPreflight && pageOrigins(c).includes(origin)
      ? Promise.resolve(
          c.body(null, 204, {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': allowedMethods,
            'access-control-allow-headers': allowedHeaders,
            'access-control-max-age': preflightCacheSeconds,
            ...privateNetworkOf(c.req.header('access-control-request-private-network')),
            vary: 'Origin',
          }),
        )
      : next();
  };
}

function allowOrigin(pageOrigins: PageOriginsOf): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    await next();
    const origin = c.req.header('origin') ?? '';
    c.res.headers.append('vary', 'Origin');
    if (pageOrigins(c).includes(origin)) {
      c.res.headers.set('access-control-allow-origin', origin);
      c.res.headers.set('access-control-expose-headers', exposedHeaders);
    }
  };
}

export function corsFor(
  pages: PageSettings,
  resource: ProtectedResource | undefined,
): readonly MiddlewareHandler<ApiEnv>[] {
  const pageOrigins: PageOriginsOf = (c) => pageOriginsOf(pages, publicOriginOf(c, resource));
  return [answerPreflight(pageOrigins), allowOrigin(pageOrigins)];
}
