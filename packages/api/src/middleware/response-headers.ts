import { Hono, type MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { ApiEnv } from '../api-env.ts';
import { servesStudioAt, type ApiStudio } from '../studio/served-studio.ts';
import { servedStudioPolicyOf } from '../studio/studio-policy.ts';
import { assignRequestId } from './request-id.ts';

const frameHeaders = { strictTransportSecurity: false, xFrameOptions: 'DENY' } as const;

const securityHeaders = secureHeaders({
  ...frameHeaders,
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
});

const otherHeadersOfTheServedStudio = secureHeaders(frameHeaders);

const policyOfAPageWithoutScripts = servedStudioPolicyOf([]);

const servedStudioHeaders: MiddlewareHandler<ApiEnv> = (c, next) =>
  otherHeadersOfTheServedStudio(c, async () => {
    await next();
    if (!c.res.headers.has('content-security-policy')) {
      c.res.headers.set('content-security-policy', policyOfAPageWithoutScripts);
    }
  });

function securityHeadersFor(studio: ApiStudio): MiddlewareHandler<ApiEnv> {
  const servesStudio = servesStudioAt(studio);
  return (c, next) => (servesStudio(c.req.path) ? servedStudioHeaders(c, next) : securityHeaders(c, next));
}

export function requestIdAndSecurityHeadersFor(studio: ApiStudio): readonly MiddlewareHandler<ApiEnv>[] {
  return [assignRequestId, securityHeadersFor(studio)];
}

export async function withRequestIdAndSecurityHeaders(response: Response, requestId: string): Promise<Response> {
  const headersApp = new Hono<ApiEnv>();
  headersApp.use(securityHeaders);
  headersApp.all('*', () => response);
  const secured = await headersApp.fetch(new Request('http://localhost/'));
  secured.headers.set('x-request-id', requestId);
  return secured;
}
