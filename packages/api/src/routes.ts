import type { ProtectedResource } from '@on.auto/identity';
import { Context as Effects } from 'effect';
import type { Context, Hono } from 'hono';

import type { ApiEnv } from './api-env.ts';
import type { ReportThrown } from './problem/error-boundary.ts';

export type RouteHandler = (c: Context<ApiEnv>) => Response | Promise<Response>;

export type Close = () => Promise<void>;

export type CallContext = (request: Request) => Effects.Context<never>;

export const noContextOfTheCall: CallContext = () => Effects.empty();

export interface ApiApp {
  readonly app: Hono<ApiEnv>;
  readonly close: Close;
}

export interface Routes {
  readonly add: (method: string, path: string, handler: RouteHandler) => void;
  readonly addPublic: (method: string, path: string, handler: RouteHandler) => void;
  readonly onClose: (close: Close) => void;
  readonly reportThrown: ReportThrown;
  readonly resource: ProtectedResource | undefined;
  readonly callContext: CallContext;
}

export type RegisterRoutes = (routes: Routes) => void;
