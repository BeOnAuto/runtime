import { pageOriginsOf, type PageSettings, type ProtectedResource } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { publicOriginOf } from '../discovery/public-addresses.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

const foreignOrigin = problemOf('origin_not_allowed', 'The origin of this request is not allowed');

export function validateOrigin(
  pages: PageSettings,
  resource: ProtectedResource | undefined,
): MiddlewareHandler<ApiEnv> {
  return (c, next) => {
    const origin = c.req.header('origin');
    return origin === undefined || pageOriginsOf(pages, publicOriginOf(c, resource)).includes(origin)
      ? next()
      : Promise.resolve(problemResponse(foreignOrigin));
  };
}
