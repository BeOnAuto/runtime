import { afterEach, describe, expect, it } from 'vitest';

import { call, createTestHandler, echoRequestId } from '../testing/api-calls.ts';
import { exchanged, listenOnLoopback } from '../testing/listening.ts';
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

const answeredRequests: ReadonlyArray<readonly [string, Readonly<Record<string, string>>, number]> = [
  ['an answer', asAdmin, 200],
  ['a rejection', {}, 401],
];

const closing: (() => Promise<void>)[] = [];

async function listening(): Promise<string> {
  const { handler } = await operationServer({ allowedOrigins: [allowed] });
  const listened = await listenOnLoopback(handler);
  closing.push(listened.close);
  return listened.origin;
}

function preflightFromCors(origin: string, privateNetwork: Readonly<Record<string, string>> = {}) {
  return {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', ...privateNetwork },
  };
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

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

describe('a request from an allowed origin', () => {
  it.each(answeredRequests)(
    'carries that origin, Vary: Origin and x-request-id, x-trace-id, www-authenticate and Date exposed on %s',
    async (_case, headers, status) => {
      const { handler } = await operationServer({ allowedOrigins: [allowed] });

      const answer = await call(handler, notes, { headers: { origin: allowed, ...headers } });

      expect(answer.status).toBe(status);
      expect(corsHeadersOf(answer.headers)).toEqual({
        allowOrigin: allowed,
        exposeHeaders: 'x-request-id, x-trace-id, www-authenticate, date',
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

describe('cors over http', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('an answer to a page at an allowed origin, over HTTP', () => {
    it('lets the page read the Date the server answers with, beside the headers it exposes already', async () => {
      const answered = await exchanged(await listening(), notes, {
        headers: { origin: allowed, authorization: `Bearer ${acmeAdmin.key}` },
      });

      expect(answered.status).toBe(200);
      expect(Number.isNaN(Date.parse(String(answered.headers.date)))).toBe(false);
      expect(String(answered.headers['access-control-expose-headers']).split(', ')).toEqual([
        'x-request-id',
        'x-trace-id',
        'www-authenticate',
        'date',
      ]);
    });
  });

  describe('a preflight of a page at an allowed origin, over HTTP', () => {
    it('allows the page to reach a server on a private network where the preflight asks, and says nothing where it does not', async () => {
      const origin = await listening();

      const asked = await exchanged(
        origin,
        notes,
        preflightFromCors(allowed, { 'access-control-request-private-network': 'true' }),
      );
      const unasked = await exchanged(origin, notes, preflightFromCors(allowed));

      expect([asked.status, asked.headers['access-control-allow-private-network']]).toEqual([204, 'true']);
      expect([unasked.status, unasked.headers['access-control-allow-private-network']]).toEqual([204, undefined]);
    });
  });

  describe('a preflight of a page at an origin the server does not allow, over HTTP', () => {
    it('is refused, allowing neither the page nor its reach of a server on a private network, though the preflight asks', async () => {
      const refused = await exchanged(
        await listening(),
        notes,
        preflightFromCors('https://elsewhere.example', { 'access-control-request-private-network': 'true' }),
      );

      expect([
        refused.status,
        refused.headers['access-control-allow-origin'],
        refused.headers['access-control-allow-private-network'],
      ]).toEqual([403, undefined, undefined]);
    });
  });
});

describe('the request id', () => {
  it('is a fresh UUID on every response, never the one a client sends', async () => {
    const { handler } = createTestHandler();
    const sent = '00000000-0000-4000-8000-000000000000';

    const first = await call(handler, '/health', { headers: { 'x-request-id': sent } });
    const second = await call(handler, '/nowhere');

    expect(first.headers.get('x-request-id')).toMatch(uuid);
    expect(second.headers.get('x-request-id')).toMatch(uuid);
    expect(first.headers.get('x-request-id')).not.toBe(sent);
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
  });

  it('is the one a mounted route reads, along with the caller', async () => {
    const { handler } = createTestHandler({ routes: [echoRequestId] });

    const answer = await call(handler, '/echo');

    expect(answer.body).toEqual({ requestId: answer.headers.get('x-request-id'), caller: 'anyone' });
  });
});
