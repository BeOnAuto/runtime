import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { withUserAgent } from '../index.ts';

interface Heard {
  readonly method: string;
  readonly userAgent: string | undefined;
  readonly tenant: string | undefined;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const runtime = 'auto-runtime/1.2.3';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function listening() {
  const heard: Heard[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const tenant = request.headers['x-tenant'];
    heard.push({
      method: String(request.method),
      userAgent: request.headers['user-agent'],
      tenant: typeof tenant === 'string' ? tenant : undefined,
    });
    response.writeHead(204).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closing.push(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  return { url: new URL(`http://127.0.0.1:${portOf(server.address()).port}/`), heard: () => [...heard] };
}

describe('a request sent through the fetch of the runtime', () => {
  it('carries the User-Agent of the runtime where it carries none, whatever form its headers take', async () => {
    const api = await listening();
    const fetch = withUserAgent(globalThis.fetch, runtime);

    await fetch(api.url);
    await fetch(api.url.href, { method: 'POST', headers: { 'X-Tenant': 'acme-eu' }, body: 'note' });
    await fetch(api.url, { headers: new Headers({ 'X-Tenant': 'acme-us' }) });
    await fetch(api.url, { headers: [['X-Tenant', 'acme-ap']] });

    expect(api.heard()).toEqual([
      { method: 'GET', userAgent: runtime, tenant: undefined },
      { method: 'POST', userAgent: runtime, tenant: 'acme-eu' },
      { method: 'GET', userAgent: runtime, tenant: 'acme-us' },
      { method: 'GET', userAgent: runtime, tenant: 'acme-ap' },
    ]);
  });

  it('keeps a User-Agent it carries already, written in any case and in any form', async () => {
    const api = await listening();
    const fetch = withUserAgent(globalThis.fetch, runtime);

    await fetch(api.url, { headers: { 'User-Agent': 'operator/2.0' } });
    await fetch(api.url, { headers: new Headers({ 'user-agent': 'operator/2.1' }) });
    await fetch(api.url, { headers: [['USER-AGENT', 'operator/2.2']] });

    expect(api.heard().map(({ userAgent }) => userAgent)).toEqual(['operator/2.0', 'operator/2.1', 'operator/2.2']);
  });

  it('leaves headers it cannot read as written to the fetch beneath it, which sends its own User-Agent', async () => {
    const api = await listening();
    const fetch = withUserAgent(globalThis.fetch, runtime);

    await fetch(api.url, { headers: { 'X-Tenant': 7 } });
    await expect(fetch(api.url, { headers: [['X-Tenant', 'acme-eu', 'more']] })).rejects.toThrow(TypeError);

    expect(api.heard()).toEqual([{ method: 'GET', userAgent: 'node', tenant: '7' }]);
  });
});
