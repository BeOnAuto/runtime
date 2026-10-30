import { describe, expect, it } from 'vitest';

import type { RegisterRoutes } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';

const uuid = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

const notAnError: Error = { name: 'Secret', message: 'database password is hunter2' };

const failing: RegisterRoutes = (routes) => {
  routes.add('GET', '/error', () => {
    throw new Error('database password is hunter2');
  });
  routes.add('GET', '/not-an-error', () => {
    throw notAnError;
  });
};

function internalProblemWith(incident: string | undefined): Readonly<Record<string, unknown>> {
  return {
    type: 'https://on.auto/problems/internal',
    title: 'Internal error',
    status: 500,
    detail: 'An unexpected error occurred',
    reason: 'internal',
    instance: `urn:uuid:${String(incident)}`,
  };
}

describe('an unexpected error', () => {
  it('answers 500 identified only by the urn:uuid of an incident, and reports the error under that id', async () => {
    const { handler, reported } = createTestHandler({ routes: [failing] });

    const answer = await call(handler, '/error');
    const [report] = reported;

    expect(answer.status).toBe(500);
    expect(report?.incident).toMatch(uuid);
    expect(answer.body).toEqual(internalProblemWith(report?.incident));
    expect(answer.text).not.toContain('hunter2');
    expect(reported).toEqual([
      {
        incident: report?.incident,
        requestId: answer.headers.get('x-request-id'),
        message: 'database password is hunter2',
      },
    ]);
    expect(answer.headers.get('x-request-id')).toMatch(uuid);
  });
});

describe('a thrown value that is not an Error', () => {
  it('answers the same 500 problem document, and reports an Error whose cause is the value', async () => {
    const { handler, reported } = createTestHandler({ routes: [failing] });

    const answer = await call(handler, '/not-an-error');
    const [report] = reported;

    expect(answer.status).toBe(500);
    expect(answer.headers.get('content-type')).toBe('application/problem+json');
    expect(report?.incident).toMatch(uuid);
    expect(answer.body).toEqual(internalProblemWith(report?.incident));
    expect(answer.text).not.toContain('hunter2');
    expect(reported).toEqual([
      {
        incident: report?.incident,
        requestId: answer.headers.get('x-request-id'),
        message: 'A value that is not an Error was thrown',
        cause: notAnError,
      },
    ]);
  });

  it('answers with the request id and the security headers every other response carries', async () => {
    const { handler } = createTestHandler({ routes: [failing] });

    const { headers } = await call(handler, '/not-an-error');

    expect(headers.get('x-request-id')).toMatch(uuid);
    expect({
      contentTypeOptions: headers.get('x-content-type-options'),
      frameOptions: headers.get('x-frame-options'),
      contentSecurityPolicy: headers.get('content-security-policy'),
      strictTransportSecurity: headers.get('strict-transport-security'),
    }).toEqual({
      contentTypeOptions: 'nosniff',
      frameOptions: 'DENY',
      contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'",
      strictTransportSecurity: null,
    });
  });
});
