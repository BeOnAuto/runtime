import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';
import { servedStudio } from '../testing/studios.ts';

const allowed = 'https://app.example';

const notes = '/v1/orgs/acme/playbooks/alpha/notes';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

function preflightFrom(origin: string): Readonly<Record<string, string>> {
  return {
    origin,
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization, content-type',
  };
}

function corsHeadersOf(headers: Headers): Readonly<Record<string, string | null>> {
  return {
    allowOrigin: headers.get('access-control-allow-origin'),
    exposeHeaders: headers.get('access-control-expose-headers'),
    allowCredentials: headers.get('access-control-allow-credentials'),
    vary: headers.get('vary'),
  };
}

describe('a preflight request from an allowed origin', () => {
  it('is answered 204 before authentication, with the methods and headers the API allows, trace context among them', async () => {
    const { handler } = await operationServer({ allowedOrigins: [allowed] });

    const answer = await call(handler, notes, { method: 'OPTIONS', headers: preflightFrom(allowed) });

    expect(answer.status).toBe(204);
    expect({
      allowOrigin: answer.headers.get('access-control-allow-origin'),
      allowMethods: answer.headers.get('access-control-allow-methods'),
      allowHeaders: answer.headers.get('access-control-allow-headers'),
      maxAge: answer.headers.get('access-control-max-age'),
      allowCredentials: answer.headers.get('access-control-allow-credentials'),
      vary: answer.headers.get('vary'),
    }).toEqual({
      allowOrigin: allowed,
      allowMethods: 'GET, HEAD, POST, PUT, DELETE',
      allowHeaders: 'authorization, content-type, traceparent, tracestate, baggage',
      maxAge: '600',
      allowCredentials: null,
      vary: 'Origin',
    });
  });
});

describe('a preflight request that is not allowed', () => {
  it('is rejected with 403 when it comes from an origin that is not allowed', async () => {
    const { handler } = await operationServer({ allowedOrigins: [allowed] });

    const answer = await call(handler, notes, { method: 'OPTIONS', headers: preflightFrom('https://evil.example') });

    expect(answer).toMatchObject({ status: 403, body: { reason: 'origin_not_allowed' } });
    expect(answer.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('is not a preflight without Access-Control-Request-Method, so OPTIONS gets 405', async () => {
    const { handler } = await operationServer({ allowedOrigins: [allowed] });

    const answer = await call(handler, notes, { method: 'OPTIONS', headers: { origin: allowed, ...asAdmin } });

    expect(answer).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
  });
});

const answeredRequests: ReadonlyArray<readonly [string, Readonly<Record<string, string>>, number]> = [
  ['an answer', asAdmin, 200],
  ['a rejection', {}, 401],
];

describe('a request from an allowed origin', () => {
  it.each(answeredRequests)(
    'carries that origin, Vary: Origin and x-request-id and x-trace-id exposed on %s',
    async (_case, headers, status) => {
      const { handler } = await operationServer({ allowedOrigins: [allowed] });

      const answer = await call(handler, notes, { headers: { origin: allowed, ...headers } });

      expect(answer.status).toBe(status);
      expect(corsHeadersOf(answer.headers)).toEqual({
        allowOrigin: allowed,
        exposeHeaders: 'x-request-id, x-trace-id, www-authenticate',
        allowCredentials: null,
        vary: 'Origin',
      });
    },
  );
});

describe('a request without an Origin header', () => {
  it('carries Vary: Origin and no other CORS header', async () => {
    const { handler } = await operationServer({ allowedOrigins: [allowed] });

    const answer = await call(handler, notes, { headers: asAdmin });

    expect(corsHeadersOf(answer.headers)).toEqual({
      allowOrigin: null,
      exposeHeaders: null,
      allowCredentials: null,
      vary: 'Origin',
    });
  });
});

describe('the studio', () => {
  const studio = 'https://studio.on.auto';

  it('may call a server that lists no origins', async () => {
    const { handler } = await operationServer();

    const preflight = await call(handler, notes, { method: 'OPTIONS', headers: preflightFrom(studio) });
    const answer = await call(handler, notes, { headers: { origin: studio, ...asAdmin } });

    expect({
      preflight: preflight.status,
      preflightAllows: preflight.headers.get('access-control-allow-origin'),
      answer: answer.status,
      answerAllows: answer.headers.get('access-control-allow-origin'),
    }).toEqual({ preflight: 204, preflightAllows: studio, answer: 200, answerAllows: studio });
  });
});

describe('a page at the origin of the runtime itself', () => {
  const own = 'http://localhost';

  it('is answered as a page of an allowed origin where the runtime serves Studio', async () => {
    const { handler } = await operationServer({ studio: servedStudio });

    const preflight = await call(handler, notes, { method: 'OPTIONS', headers: preflightFrom(own) });
    const answer = await call(handler, notes, { headers: { origin: own, ...asAdmin } });

    expect([preflight.status, preflight.headers.get('access-control-allow-origin'), answer.status]).toEqual([
      204,
      own,
      200,
    ]);
    expect(corsHeadersOf(answer.headers)).toMatchObject({ allowOrigin: own });
  });

  it('is refused where the runtime serves no Studio', async () => {
    const { handler } = await operationServer();

    const preflight = await call(handler, notes, { method: 'OPTIONS', headers: preflightFrom(own) });

    expect(preflight).toMatchObject({ status: 403, body: { reason: 'origin_not_allowed' } });
  });
});
