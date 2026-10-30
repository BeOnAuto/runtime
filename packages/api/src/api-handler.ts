import type { IncomingMessage, ServerResponse } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import { randomUUIDv7 } from '@on.auto/operations';
import { Function } from 'effect';

import type { ApiBindings } from './api-env.ts';
import type { ApiOptions } from './api-options.ts';
import { createApp } from './app.ts';
import { withRequestIdAndSecurityHeaders } from './middleware/response-headers.ts';
import { errorHandler } from './problem/error-boundary.ts';
import { badRequestHandler } from './problem/unreadable-request.ts';

export interface ApiHandler {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly listener: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  readonly close: () => Promise<void>;
}

interface Destroyable {
  readonly destroy: () => unknown;
}

interface Responding {
  readonly outgoing: Destroyable;
}

const inProcess: ApiBindings = { abortConnection: Function.constVoid };

function abortingOf(outgoing: Destroyable): ApiBindings {
  return {
    abortConnection: () => {
      outgoing.destroy();
    },
  };
}

export function createApiHandler(options: ApiOptions): ApiHandler {
  const { app, close } = createApp(options);
  const handleError = errorHandler(options.reportIncident);
  const handle = async (request: Request, bindings: ApiBindings): Promise<Response> => {
    try {
      return await app.fetch(request, bindings);
    } catch (thrown) {
      const requestId = randomUUIDv7();
      return withRequestIdAndSecurityHeaders(handleError(thrown, requestId), requestId);
    }
  };
  return {
    fetch: (request) => handle(request, inProcess),
    listener: getRequestListener(
      (request: Request, { outgoing }: Responding) => handle(request, abortingOf(outgoing)),
      {
        overrideGlobalObjects: false,
        errorHandler: () => withRequestIdAndSecurityHeaders(badRequestHandler(), randomUUIDv7()),
      },
    ),
    close,
  };
}
