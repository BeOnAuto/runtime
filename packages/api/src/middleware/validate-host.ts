import { loopbackNames } from '@on.auto/operations';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

const localHost = new RegExp(`^(?:${loopbackNames.map((name) => RegExp.escape(name)).join('|')})(?::\\d+)?$`, 'iu');

const foreignHost = problemOf('forbidden', 'Local mode accepts only a localhost Host header');

export function isLocalHost(host: string): boolean {
  return localHost.test(host);
}

export const validateHost: MiddlewareHandler<ApiEnv> = (c, next) =>
  isLocalHost(c.req.header('host') ?? '') ? next() : Promise.resolve(problemResponse(foreignHost));
