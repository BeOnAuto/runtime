import { describe, expect, it } from 'vitest';

import { licensePath, meteredServer } from '../metering-testing/fixture.ts';

function headersFor(contentType: string | undefined) {
  return contentType === undefined ? {} : { 'content-type': contentType };
}

describe('bounded license requests over HTTP', () => {
  it.each([
    [undefined, '{}', 415],
    ['text/plain', '{}', 415],
    ['application/json', '{', 400],
    ['application/json', '', 400],
    ['application/json', JSON.stringify({ activationKey: 'ø'.repeat(4096) }), 413],
    ['application/json', JSON.stringify({ activationKey: '' }), 422],
    ['application/json', JSON.stringify({ activationKey: 123 }), 422],
    ['application/json', JSON.stringify({ activationKey: 'secret', override: true }), 422],
  ] as const)('refuses an invalid request without contacting the authority: %#', async (contentType, body, status) => {
    const server = await meteredServer();
    const response = await fetch(`${server.origin}${licensePath}/activate`, {
      method: 'POST',
      body,
      headers: headersFor(contentType),
    });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('ø');
    expect(server.authority.requests).toEqual([]);
  });

  it('rejects an invalid close identity, reports an empty installation, and hides refused credentials', async () => {
    const server = await meteredServer();
    expect(await server.call('POST', `${licensePath}/close`, { body: { allocationId: '../different' } })).toMatchObject(
      { status: 422 },
    );
    expect(await server.call('POST', `${licensePath}/report`)).toMatchObject({ status: 200, body: { delivery: null } });
    const refused = await server.call('POST', `${licensePath}/activate`, {
      body: { activationKey: 'do-not-expose-this' },
    });
    expect(refused).toMatchObject({
      status: 409,
      body: { detail: 'The account service refused this license request.' },
    });
    expect(refused.text).not.toContain('do-not-expose-this');
    server.authority.state.challengeStatus = 503;
    expect(
      await server.call('POST', `${licensePath}/activate`, { body: { activationKey: 'activation-secret' } }),
    ).toMatchObject({ status: 503, body: { detail: 'The Runtime meter could not complete this request. Try again.' } });
  });
});
