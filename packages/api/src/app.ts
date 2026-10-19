import { Hono } from 'hono';
import { methodNotAllowed } from 'hono/method-not-allowed';

import type { ApiOptions } from './api-options.ts';
import { protectedResourceRoutes } from './authentication/protected-resource.ts';
import { healthRoutes } from './discovery/health.ts';
import { middlewareFor } from './middleware/middleware-chain.ts';
import { errorHandler, failureOfThrown } from './problem/error-boundary.ts';
import { problemOf, problemResponse } from './problem/problem.ts';
import type { ApiApp, Close } from './routes.ts';
import { studioRoutes } from './studio/served-studio.ts';

export function createApp(options: ApiOptions): ApiApp {
  const app: ApiApp['app'] = new Hono();
  const closes: Close[] = [];
  const publicPaths = new Set<string>();
  app.use(...middlewareFor(options, publicPaths));
  app.use(
    methodNotAllowed({
      app,
      onMethodNotAllowed: (_c, methods: readonly string[]) =>
        problemResponse(problemOf('method_not_allowed', 'The path does not support this method'), {
          allow: methods.toSorted().join(', '),
        }),
    }),
  );
  const { resource } = options.authenticator;
  for (const { path, handler } of protectedResourceRoutes(resource)) {
    app.get(path, handler);
  }
  const reportThrown = failureOfThrown(options.reportIncident);
  for (const register of [healthRoutes, studioRoutes(options.studio), ...options.routes]) {
    register({
      add: (method, path, handler) => {
        app.on(method, path, handler);
      },
      addPublic: (method, path, handler) => {
        publicPaths.add(path);
        app.on(method, path, handler);
      },
      onClose: (close) => {
        closes.push(close);
      },
      reportThrown,
      resource,
    });
  }
  app.notFound(() => problemResponse(problemOf('not_found', 'No route matches the path')));
  const handleError = errorHandler(options.reportIncident);
  app.onError((error: Readonly<Error>, c) => handleError(error, c.get('requestId')));
  return {
    app,
    close: async () => {
      await Promise.all(closes.map((close) => close()));
    },
  };
}
