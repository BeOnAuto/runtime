import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { testShelf } from '../testing/guides.ts';
import { listenOnLoopback } from '../testing/listening.ts';
import { operationServer, type OperationServer } from '../testing/operation-server.ts';
import { publicUrl, signedInServer } from '../testing/signed-in.ts';

let server: OperationServer;

beforeAll(async () => {
  server = await operationServer();
});

afterAll(async () => {
  await server.runtime.dispose();
});

function catalogFrom(origin: string, method = 'GET'): Promise<Response> {
  return server.handler.fetch(new Request(`${origin}/.well-known/api-catalog`, { method }));
}

const origin = 'https://runtime.example:8443';

describe('the API catalog', () => {
  it('is answered without a key as a linkset of the API catalog profile, its addresses those of the origin asked', async () => {
    const answer = await catalogFrom(origin);
    const catalog: unknown = await answer.json();

    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    );
    expect(catalog).toEqual({
      linkset: [
        { anchor: `${origin}/.well-known/api-catalog`, item: [{ href: `${origin}/v1` }] },
        {
          anchor: `${origin}/v1`,
          'service-desc': [{ href: `${origin}/v1/openapi.json`, type: 'application/json' }],
          'service-doc': testShelf.everyGuide.map(({ name, title }) => ({
            href: `${origin}/v1/guides/${name}`,
            type: 'text/markdown',
            title,
          })),
          status: [{ href: `${origin}/health` }],
        },
      ],
    });
  });

  it('names itself by the api-catalog relation, and answers HEAD with that link and no body', async () => {
    const [got, head] = await Promise.all([catalogFrom(origin), catalogFrom(origin, 'HEAD')]);
    const link = `<${origin}/.well-known/api-catalog>; rel="api-catalog"`;

    expect([got.headers.get('link'), head.headers.get('link')]).toEqual([link, link]);
    expect([head.status, await head.text()]).toEqual([200, '']);
    expect(head.headers.get('etag')).toBe(got.headers.get('etag'));
  });
});

describe('the API catalog on a Node listener', () => {
  it('answers HEAD with the link of the origin it listens on, its tag and no body', async () => {
    const listening = await listenOnLoopback(server.handler);
    const head = await fetch(`${listening.origin}/.well-known/api-catalog`, { method: 'HEAD' });
    await listening.close();

    expect([head.status, head.headers.get('link'), await head.text()]).toEqual([
      200,
      `<${listening.origin}/.well-known/api-catalog>; rel="api-catalog"`,
      '',
    ]);
    expect(head.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/u);
  });
});

describe('the API catalog of each origin', () => {
  it('is a catalog of its own, by its own entity tag', async () => {
    const [here, there] = await Promise.all([catalogFrom(origin), catalogFrom('http://localhost')]);

    expect(here.headers.get('etag')).not.toBe(there.headers.get('etag'));
  });

  it('is the origin the server receives, whatever X-Forwarded-Host and X-Forwarded-Proto say', async () => {
    const forwarded = await server.handler.fetch(
      new Request('http://localhost/.well-known/api-catalog', {
        headers: { 'x-forwarded-host': 'public.example', 'x-forwarded-proto': 'https' },
      }),
    );
    const catalog: unknown = await forwarded.json();

    expect(catalog).toMatchObject({
      linkset: [{ anchor: 'http://localhost/.well-known/api-catalog' }, { anchor: 'http://localhost/v1' }],
    });
    expect(forwarded.headers.get('link')).toBe('<http://localhost/.well-known/api-catalog>; rel="api-catalog"');
  });
});

describe('the API catalog of a server whose PUBLIC_URL is set', () => {
  it('names PUBLIC_URL as the origin of every address, whatever origin the request reached', async () => {
    const { server: signedIn } = await signedInServer();
    const answer = await signedIn.handler.fetch(new Request(`${origin}/.well-known/api-catalog`));
    const catalog: unknown = await answer.json();

    expect(catalog).toMatchObject({
      linkset: [
        { anchor: `${publicUrl}/.well-known/api-catalog`, item: [{ href: `${publicUrl}/v1` }] },
        {
          anchor: `${publicUrl}/v1`,
          'service-desc': [{ href: `${publicUrl}/v1/openapi.json` }],
          status: [{ href: `${publicUrl}/health` }],
        },
      ],
    });
    expect(answer.headers.get('link')).toBe(`<${publicUrl}/.well-known/api-catalog>; rel="api-catalog"`);
  });
});

describe('the health of the server', () => {
  it('names the API catalog by its relation, so a client given only this address finds it', async () => {
    const answer = await call(server.handler, '/health');

    expect(answer).toMatchObject({ status: 200, body: { status: 'ok' } });
    expect(answer.headers.get('link')).toBe('</.well-known/api-catalog>; rel="api-catalog"');
    expect(answer.headers.get('cache-control')).toBe('no-store');
  });
});
