import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { ApiOptions } from '../api-options.ts';
import { authenticate } from '../authentication/authentication.ts';
import { landingPageFor } from '../landing/landing-page.ts';
import { corsFor } from './cors.ts';
import { exceptOn, needingNoCallerOf, publicPathsOf } from './public-paths.ts';
import { requestIdAndSecurityHeadersFor } from './response-headers.ts';
import { validateHost } from './validate-host.ts';
import { validateOrigin } from './validate-origin.ts';

export function middlewareFor(
  { allowedOrigins, studio, authenticator, requests, runtimeControl, installId, licenseNotice, pageStyle }: ApiOptions,
  publicPaths: ReadonlySet<string>,
): readonly MiddlewareHandler<ApiEnv>[] {
  const isPublic = publicPathsOf(authenticator, publicPaths);
  const hostValidation = authenticator.mode === 'local' ? [validateHost] : [];
  const pages = { studio, allowedOrigins };
  return [
    ...(requests === undefined ? [] : [requests]),
    landingPageFor({
      control: runtimeControl,
      studio,
      resource: authenticator.resource,
      installId,
      licenseNotice,
      style: pageStyle,
    }),
    ...requestIdAndSecurityHeadersFor(studio),
    ...[validateOrigin(pages, authenticator.resource), ...hostValidation].map((middleware) =>
      exceptOn(isPublic, middleware),
    ),
    ...corsFor(pages, authenticator.resource),
    exceptOn(needingNoCallerOf(isPublic, studio), authenticate(authenticator)),
  ];
}
