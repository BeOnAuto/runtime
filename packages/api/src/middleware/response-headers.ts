import { Hono, type MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { ApiEnv } from '../api-env.ts';
import { servesContentAt } from '../content/content-routes.ts';
import { debugPath } from '../debug/debug-path.ts';
import { servesStudioAt, type ApiStudio } from '../studio/served-studio.ts';
import { servedStudioPolicyOf } from '../studio/studio-policy.ts';
import { assignRequestId } from './request-id.ts';

const frameHeaders = { strictTransportSecurity: false, xFrameOptions: 'DENY' } as const;

const policyOfAnAnswer = { defaultSrc: ["'none'"], frameAncestors: ["'none'"] };

const securityHeaders = secureHeaders({ ...frameHeaders, contentSecurityPolicy: policyOfAnAnswer });

const headersOfContentAnyOriginEmbeds = secureHeaders({
  ...frameHeaders,
  crossOriginResourcePolicy: 'cross-origin',
  contentSecurityPolicy: { ...policyOfAnAnswer, sandbox: [] },
});

const headersBesidePagePolicy = secureHeaders(frameHeaders);

const policyOfAPageWithoutScripts = servedStudioPolicyOf([]);

const headersOfAPage: MiddlewareHandler<ApiEnv> = (c, next) =>
  headersBesidePagePolicy(c, async () => {
    await next();
    if (!c.res.headers.has('content-security-policy')) {
      c.res.headers.set('content-security-policy', policyOfAPageWithoutScripts);
    }
  });

function securityHeadersFor(studio: ApiStudio): MiddlewareHandler<ApiEnv> {
  const servesStudio = servesStudioAt(studio);
  return (c, next) => {
    if (servesStudio(c.req.path) || c.req.path === debugPath) {
      return headersOfAPage(c, next);
    }
    return servesContentAt(c.req.path) ? headersOfContentAnyOriginEmbeds(c, next) : securityHeaders(c, next);
  };
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
