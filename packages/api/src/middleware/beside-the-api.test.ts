import { describe, expect, it } from 'vitest';

import { middlewareBesideTheApi, type MiddlewareOutcome } from './beside-the-api.ts';

const publicUrl = 'https://auto.example.com';

const studio = { origin: 'https://studio.example.com', served: false };

const middleware = middlewareBesideTheApi({ studio, allowedOrigins: [], publicUrl });

function passedOf(outcome: MiddlewareOutcome): Headers {
  return 'passed' in outcome ? outcome.passed : new Headers();
}

function answeredOf(outcome: MiddlewareOutcome): Response {
  return 'answered' in outcome ? outcome.answered : new Response(null, { status: 299 });
}

function asked(headers: Readonly<Record<string, string>>, method = 'POST'): Request {
  return new Request(`${publicUrl}/oauth/token`, { method, headers });
}

describe('the middleware of the API, for a path a handler beside it answers', () => {
  it('passes a request on with the request id, the security headers and the CORS headers of an allowed page', async () => {
    const outcome = await middleware(asked({ origin: studio.origin }));

    const passed = passedOf(outcome);
    expect({
      requestId: passed.has('x-request-id'),
      policy: passed.get('content-security-policy'),
      noSniff: passed.get('x-content-type-options'),
      allowOrigin: passed.get('access-control-allow-origin'),
    }).toEqual({
      requestId: true,
      policy: "default-src 'none'; frame-ancestors 'none'",
      noSniff: 'nosniff',
      allowOrigin: studio.origin,
    });
  });

  it('passes on a form of a page of the handler beside it, which posts from the public origin', async () => {
    const outcome = await middleware(asked({ origin: publicUrl }));

    expect(passedOf(outcome).has('x-request-id')).toBe(true);
  });

  it('answers a preflight of an allowed page itself, private network access included, and refuses another origin', async () => {
    const preflight = await middleware(
      asked(
        {
          origin: studio.origin,
          'access-control-request-method': 'POST',
          'access-control-request-private-network': 'true',
        },
        'OPTIONS',
      ),
    );
    const elsewhere = await middleware(asked({ origin: 'https://elsewhere.example.com' }));

    const answers = [preflight, elsewhere].map((outcome) => answeredOf(outcome));
    expect(answers.map((answer) => answer.status)).toEqual([204, 403]);
    expect(answers[0]?.headers.get('access-control-allow-private-network')).toBe('true');
  });
});
