import { once } from 'node:events';
import { createServer } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import type { ApiHandler, RegisterRoutes } from './index.ts';
import { call, echoRequestId, createTestHandler } from './testing/api-calls.ts';

function portOf(address: Readonly<AddressInfo> | string | null): number {
  return typeof address === 'object' && address !== null ? address.port : 0;
}

async function serve(handler: ApiHandler): Promise<{ port: number; close: () => void }> {
  const server = createServer((request, response) => {
    void handler.listener(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: portOf(server.address()),
    close: () => {
      server.close();
    },
  };
}

function exchange(port: number, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = '';
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(raw);
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received += chunk;
    });
    socket.on('end', () => {
      resolve(received);
    });
    socket.on('error', reject);
  });
}

const createThings: RegisterRoutes = (routes) => {
  routes.add('POST', '/things', (c) => c.json({ created: true }, 201));
};

const notAnError: Error = { name: 'Secret', message: 'database password is hunter2' };

const failWithoutAnError: RegisterRoutes = (routes) => {
  routes.add('GET', '/fail', () => {
    throw notAnError;
  });
};

describe('the health check', () => {
  it('answers GET with exactly the JSON body it has always had', async () => {
    const answer = await call(createTestHandler().handler, '/health');

    expect({ status: answer.status, type: answer.headers.get('content-type'), text: answer.text }).toEqual({
      status: 200,
      type: 'application/json',
      text: '{"status":"ok"}',
    });
  });

  it('answers HEAD with the same status and headers and no body', async () => {
    const answer = await call(createTestHandler().handler, '/health', { method: 'HEAD' });

    expect({ status: answer.status, type: answer.headers.get('content-type'), text: answer.text }).toEqual({
      status: 200,
      type: 'application/json',
      text: '',
    });
  });

  it.each(['GET', 'HEAD'])('answers %s with a response that may not be cached', async (method) => {
    const answer = await call(createTestHandler().handler, '/health', { method });

    expect(answer.headers.get('cache-control')).toBe('no-store');
  });

  it('ignores a query string', async () => {
    expect(await call(createTestHandler().handler, '/health?probe=1')).toMatchObject({
      status: 200,
      body: { status: 'ok' },
    });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('rejects %s with 405 and Allow: GET, HEAD', async (method) => {
    const answer = await call(createTestHandler().handler, '/health', { method });

    expect(answer).toMatchObject({ status: 405, body: { reason: 'method_not_allowed', status: 405 } });
    expect(answer.headers.get('allow')).toBe('GET, HEAD');
    expect(answer.headers.get('content-type')).toBe('application/problem+json');
  });
});

describe('an unknown path', () => {
  it('answers 404 with a problem document', async () => {
    const answer = await call(createTestHandler().handler, '/nowhere');

    expect(answer.status).toBe(404);
    expect(answer.headers.get('content-type')).toBe('application/problem+json');
    expect(answer.body).toEqual({
      type: 'https://on.auto/problems/not_found',
      title: 'Not found',
      status: 404,
      detail: 'No route matches the path',
      reason: 'not_found',
    });
  });
});

describe('every response', () => {
  it.each([
    ['GET', '/health'],
    ['GET', '/nowhere'],
    ['POST', '/health'],
  ])('to %s %s carries the security headers without HSTS', async (method, path) => {
    const { headers } = await call(createTestHandler().handler, path, { method });

    expect({
      contentTypeOptions: headers.get('x-content-type-options'),
      frameOptions: headers.get('x-frame-options'),
      contentSecurityPolicy: headers.get('content-security-policy'),
      referrerPolicy: headers.get('referrer-policy'),
      strictTransportSecurity: headers.get('strict-transport-security'),
    }).toEqual({
      contentTypeOptions: 'nosniff',
      frameOptions: 'DENY',
      contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'",
      referrerPolicy: 'no-referrer',
      strictTransportSecurity: null,
    });
  });
});

describe('mounted routes', () => {
  it('answer the method they were added for, and 405 with Allow for any other', async () => {
    const { handler } = createTestHandler({ routes: [createThings, echoRequestId] });

    expect(await call(handler, '/things', { method: 'POST' })).toMatchObject({ status: 201, body: { created: true } });
    const rejected = await call(handler, '/things');
    expect(rejected).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
    expect(rejected.headers.get('allow')).toBe('POST');
  });
});

describe('the Node listener', () => {
  it('serves the same API over node:http', async () => {
    const { port, close } = await serve(createTestHandler().handler);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    close();

    expect({ status: response.status, text: await response.text() }).toEqual({ status: 200, text: '{"status":"ok"}' });
  });

  it('answers a thrown value that is not an Error with the 500 problem document, not plain text', async () => {
    const { handler, reported } = createTestHandler({ routes: [failWithoutAnError] });
    const { port, close } = await serve(handler);

    const response = await fetch(`http://127.0.0.1:${port}/fail`);
    close();

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({
      reason: 'internal',
      instance: `urn:uuid:${String(reported[0]?.incident)}`,
    });
  });

  it.each([
    [
      'a Host header that is not a host name',
      'GET /health HTTP/1.1\r\nHost: auto playbook\r\nConnection: close\r\n\r\n',
    ],
    ['no Host header at all', 'GET /health HTTP/1.0\r\n\r\n'],
  ])('answers a request with %s with a 400 problem document', async (_case, raw) => {
    const { port, close } = await serve(createTestHandler().handler);

    const response = await exchange(port, raw);
    close();

    expect(response).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/u);
    expect(response.toLowerCase()).toContain('\r\ncontent-type: application/problem+json\r\n');
    expect(response.toLowerCase()).toContain('\r\nx-content-type-options: nosniff\r\n');
    expect(response.toLowerCase()).toMatch(/\r\nx-request-id: [\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-/u);
    expect(response).toContain(
      '\r\n\r\n{"type":"https://on.auto/problems/bad_request","title":"Bad request","status":400,"detail":"The request could not be read","reason":"bad_request"}',
    );
  });
});

describe('closing the handler', () => {
  it('resolves', async () => {
    await expect(createTestHandler().handler.close()).resolves.toBeUndefined();
  });
});
