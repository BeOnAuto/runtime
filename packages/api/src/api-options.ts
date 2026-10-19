import type { Authenticator } from '@on.auto/identity';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from './api-env.ts';
import type { RuntimeControl } from './landing/runtime-control.ts';
import type { ReportIncident } from './problem/error-boundary.ts';
import type { RegisterRoutes } from './routes.ts';
import type { ApiStudio } from './studio/served-studio.ts';

export interface ApiOptions {
  readonly allowedOrigins: readonly string[];
  readonly studio: ApiStudio;
  readonly authenticator: Authenticator;
  readonly routes: readonly RegisterRoutes[];
  readonly reportIncident: ReportIncident;
  readonly requests?: MiddlewareHandler<ApiEnv>;
  readonly runtimeControl?: RuntimeControl;
}
