import { afterEach, describe, expect, it } from 'vitest';

import { exchanged, listenOnLoopback } from '../testing/listening.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

const allowed = 'https://app.example';

const notes = '/v1/orgs/acme/playbooks/alpha/notes';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function listening(): Promise<string> {
  const { handler } = await operationServer({ allowedOrigins: [allowed] });
  const listened = await listenOnLoopback(handler);
  closing.push(listened.close);
  return listened.origin;
}

function preflightFrom(origin: string, privateNetwork: Readonly<Record<string, string>> = {}) {
  return {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', ...privateNetwork },
  };
}

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
      preflightFrom(allowed, { 'access-control-request-private-network': 'true' }),
    );
    const unasked = await exchanged(origin, notes, preflightFrom(allowed));

    expect([asked.status, asked.headers['access-control-allow-private-network']]).toEqual([204, 'true']);
    expect([unasked.status, unasked.headers['access-control-allow-private-network']]).toEqual([204, undefined]);
  });
});

describe('a preflight of a page at an origin the server does not allow, over HTTP', () => {
  it('is refused, allowing neither the page nor its reach of a server on a private network, though the preflight asks', async () => {
    const refused = await exchanged(
      await listening(),
      notes,
      preflightFrom('https://elsewhere.example', { 'access-control-request-private-network': 'true' }),
    );

    expect([
      refused.status,
      refused.headers['access-control-allow-origin'],
      refused.headers['access-control-allow-private-network'],
    ]).toEqual([403, undefined, undefined]);
  });
});
