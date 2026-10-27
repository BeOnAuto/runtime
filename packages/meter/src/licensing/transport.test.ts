import { describe, expect, it } from 'vitest';

import { licenseTransport, LicenseServiceRefused } from './transport.ts';

const issuer = 'https://accounts.auto.test';

describe('the fixed account-service transport', () => {
  it('posts JSON only to the fixed HTTPS authority without redirects or a cache', async () => {
    const requests: Readonly<Request>[] = [];
    const transport = licenseTransport(`${issuer}/v1/`, (request) => {
      requests.push(request);
      return Promise.resolve(Response.json({ result: 'accepted' }, { status: 201 }));
    });
    expect(await transport('/licenses/complete', { proof: 'signed-proof' })).toEqual({ result: 'accepted' });
    expect(
      requests.map((request) => ({
        url: request.url,
        method: request.method,
        redirect: request.redirect,
        cache: request.cache,
      })),
    ).toEqual([{ url: `${issuer}/v1/licenses/complete`, method: 'POST', redirect: 'manual', cache: 'no-store' }]);
    expect(await Promise.all(requests.map((request) => request.json()))).toEqual([{ proof: 'signed-proof' }]);
  });

  it.each([301, 307, 400, 401, 403, 409, 429, 500, 503])(
    'refuses HTTP %s without reading or echoing the error body',
    async (status) => {
      const transport = licenseTransport(issuer, () =>
        Promise.resolve(
          new Response('private-response-data', { status, headers: { location: 'https://another.test' } }),
        ),
      );
      const result = transport('/licenses/complete', { proof: 'private-proof' });
      await expect(result).rejects.toBeInstanceOf(LicenseServiceRefused);
      await expect(result).rejects.toMatchObject({ message: 'license_service_refused', status });
    },
  );

  it.each([
    'http://accounts.auto.test',
    'https://name:password@accounts.auto.test',
    `${issuer}/?query=1`,
    `${issuer}/#fragment`,
  ])('refuses an unsafe authority address %s', (endpoint) => {
    expect(() => licenseTransport(endpoint, () => Promise.resolve(Response.json({})))).toThrow(
      'license_endpoint_invalid',
    );
  });

  it.each([0, 30_001, Number.NaN, 1.1])('refuses an invalid timeout %s', (timeout) => {
    expect(() => licenseTransport(issuer, () => Promise.resolve(Response.json({})), timeout)).toThrow(
      'license_timeout_invalid',
    );
  });
});

describe('bounded and private license exchanges', () => {
  it('bounds outgoing UTF-8 bytes before reaching the authority', async () => {
    const transport = licenseTransport(issuer, () => Promise.reject(new Error('must_not_send')));
    await expect(transport('/licenses/activation-challenge', { activationKey: 'é'.repeat(5000) })).rejects.toThrow(
      'license_request_invalid',
    );
    await expect(Reflect.apply(transport, undefined, ['/licenses/activation-challenge'])).rejects.toThrow(
      'license_request_invalid',
    );
  });

  it('bounds response bytes and masks network, response-shape and parsing failures', async () => {
    const oversized = licenseTransport(issuer, () =>
      Promise.resolve(Response.json({ data: 'x'.repeat(5 * 1024 * 1024) })),
    );
    await expect(oversized('/licenses/complete', {})).rejects.toThrow('license_service_unavailable');
    const malformed = licenseTransport(issuer, () => Promise.resolve(new Response('private-not-json')));
    await expect(malformed('/licenses/complete', {})).rejects.toThrow('license_service_unavailable');
    const failed = licenseTransport(issuer, () => Promise.reject(new Error('private-url-or-credential')));
    await expect(failed('/licenses/complete', {})).rejects.toThrow('license_service_unavailable');
  });

  it('aborts a hanging fetch within the transport deadline', async () => {
    const transport = licenseTransport(
      issuer,
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('private-network-error'));
            },
            { once: true },
          );
        }),
      1,
    );
    await expect(transport('/licenses/complete', {})).rejects.toThrow('license_service_unavailable');
  });
});
