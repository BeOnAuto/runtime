import type { PageSettings } from '@on.auto/identity';
import { Hono } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { corsFor } from './cors.ts';
import { assignRequestId } from './request-id.ts';
import { securityHeaders } from './response-headers.ts';
import { validateOrigin } from './validate-origin.ts';

export type MiddlewareOutcome = { readonly answered: Response } | { readonly passed: Headers };

export interface BesideTheApi extends PageSettings {
  readonly publicUrl: string;
}

const passedThrough = 204;

export function middlewareBesideTheApi({
  studio,
  allowedOrigins,
  publicUrl,
}: BesideTheApi): (request: Readonly<Request>) => Promise<MiddlewareOutcome> {
  const reached = new WeakSet<Request>();
  const pages = { studio, allowedOrigins: [...allowedOrigins, publicUrl] };
  const addressing = { resource: undefined, publicUrl };
  const app = new Hono<ApiEnv>();
  app.use(assignRequestId, securityHeaders, validateOrigin(pages, addressing), ...corsFor(pages, addressing));
  app.all('*', (c) => {
    reached.add(c.req.raw);
    return c.body(null, passedThrough);
  });
  return async (request) => {
    const answer = await app.fetch(request);
    return reached.has(request) ? { passed: answer.headers } : { answered: answer };
  };
}
