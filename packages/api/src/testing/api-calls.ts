import type { Authenticator } from '@on.auto/identity';
import { hostedStudio } from '@on.auto/identity/testing';
import { allPermissions, type CallSummary } from '@on.auto/operations';

import { createApiHandler, type ApiHandler, type ApiOptions, type RegisterRoutes } from '../index.ts';

export interface Call {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

export interface ReportedThrown {
  readonly incident: string;
  readonly requestId: string;
  readonly message: string;
  readonly cause: unknown;
  readonly call: CallSummary | undefined;
}

const admitEveryone: Authenticator = {
  mode: 'credentials',
  resource: undefined,
  authenticate: () =>
    Promise.resolve({
      own: { id: 'anyone', org: 'acme', permissions: allPermissions, playbooks: '*' },
      callerIn: (org) => ({ id: 'anyone', org, permissions: allPermissions, playbooks: '*' }),
    }),
};

export function createTestHandler(options: Partial<ApiOptions> = {}): {
  handler: ApiHandler;
  reported: ReportedThrown[];
} {
  const reported: ReportedThrown[] = [];
  const handler = createApiHandler({
    allowedOrigins: [],
    studio: hostedStudio,
    authenticator: admitEveryone,
    routes: [],
    reportIncident: (incident, error, requestId, summary) => {
      reported.push({ incident, requestId, message: error.message, cause: error.cause, call: summary });
    },
    ...options,
  });
  return { handler, reported };
}

export async function call(
  handler: ApiHandler,
  path: string,
  { method = 'GET', headers = {}, body }: Call = {},
): Promise<Answer> {
  const init = body === undefined ? { method, headers } : { method, headers, body };
  const response = await handler.fetch(new Request(`http://localhost${path}`, init));
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: text === '' ? undefined : JSON.parse(text) };
}

export const echoRequestId: RegisterRoutes = (routes) => {
  routes.add('GET', '/echo', (c) =>
    c.json({ requestId: c.get('requestId'), caller: c.get('principal').callerIn('acme')?.id }),
  );
};
