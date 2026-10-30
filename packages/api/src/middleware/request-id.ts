import { randomUUIDv7 } from '@on.auto/operations';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';

export const assignRequestId: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const requestId = randomUUIDv7();
  c.set('requestId', requestId);
  await next();
  c.header('x-request-id', requestId);
};
