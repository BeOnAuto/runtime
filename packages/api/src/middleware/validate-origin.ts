import { pageOriginsOf, type PageSettings } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { publicOriginOf, type PublicAddressing } from '../discovery/public-addresses.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

const foreignOrigin = problemOf('origin_not_allowed', 'The origin of this request is not allowed');

export function validateOrigin(pages: PageSettings, addressing: PublicAddressing): MiddlewareHandler<ApiEnv> {
  return (c, next) => {
    const origin = c.req.header('origin');
    return origin === undefined || pageOriginsOf(pages, publicOriginOf(c, addressing)).includes(origin)
      ? next()
      : Promise.resolve(problemResponse(foreignOrigin));
  };
}
