import { authenticatorFor } from '@on.auto/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call, createTestHandler } from '../testing/api-calls.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { type ClientMetadataDocument, clientMetadataRoutes } from './client-metadata.ts';

const address = 'https://runtime.example.com/oauth/client.json';

const clientMetadata: ClientMetadataDocument = {
  address,
  document: {
    client_id: address,
    client_name: 'Auto Runtime',
    redirect_uris: ['https://studio.example.com/connect-return'],
    token_endpoint_auth_method: 'none',
  },
};

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

function handlerServing(metadata?: ClientMetadataDocument) {
  return createTestHandler({
    authenticator: authenticatorFor({ host: '0.0.0.0', apiKeys: [acmeAdmin.entry] }),
    routes: [clientMetadataRoutes(metadata)],
  }).handler;
}

describe('the client metadata document', () => {
  it('is answered at the path of its address without a key and with one alike, as JSON kept for five minutes', async () => {
    const handler = handlerServing(clientMetadata);

    const [withoutKey, withKey] = [
      await call(handler, '/oauth/client.json'),
      await call(handler, '/oauth/client.json', { headers: asAdmin }),
    ];

    expect(withoutKey).toMatchObject({ status: 200, body: clientMetadata.document });
    expect(withKey.text).toBe(withoutKey.text);
    expect([withoutKey.headers.get('content-type'), withoutKey.headers.get('cache-control')]).toEqual([
      'application/json',
      'public, max-age=300',
    ]);
    expect(withoutKey.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/u);
  });

  it('answers HEAD with its tag and no body, and 304 to a request whose If-None-Match names the tag', async () => {
    const handler = handlerServing(clientMetadata);
    const etag = String((await call(handler, '/oauth/client.json')).headers.get('etag'));

    const head = await call(handler, '/oauth/client.json', { method: 'HEAD' });
    const unchanged = await call(handler, '/oauth/client.json', { headers: { 'if-none-match': etag } });

    expect([head.status, head.headers.get('etag'), head.text]).toEqual([200, etag, '']);
    expect([unchanged.status, unchanged.text]).toEqual([304, '']);
  });

  it('refuses another method with 405 and Allow, without a key', async () => {
    const answer = await call(handlerServing(clientMetadata), '/oauth/client.json', { method: 'POST' });

    expect([answer.status, answer.headers.get('allow')]).toEqual([405, 'GET, HEAD']);
  });

  it('has no route where the server gives no document, and its path needs a key as every path does', async () => {
    const handler = handlerServing();

    const withoutKey = await call(handler, '/oauth/client.json');

    expect(withoutKey.status).toBe(401);
    expect(await call(handler, '/oauth/client.json', { headers: asAdmin })).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
  });
});

let server: OperationServer;

beforeAll(async () => {
  server = await operationServer();
});

afterAll(async () => {
  await server.runtime.dispose();
});

const publicAnswers = ['/v1/openapi.json', '/v1/guides/notebook', '/.well-known/api-catalog'];

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

async function fetched(path: string, headers: Readonly<Record<string, string>> = {}, method = 'GET'): Promise<Answer> {
  const response = await server.handler.fetch(new Request(`http://localhost${path}`, { method, headers }));
  return { status: response.status, headers: response.headers, text: await response.text() };
}

async function entityTagOf(path: string): Promise<string> {
  return String((await fetched(path)).headers.get('etag'));
}

function cachingOf({ status, headers, text }: Answer): readonly unknown[] {
  return [status, headers.get('etag'), headers.get('cache-control'), text];
}

describe('a public answer', () => {
  it.each(publicAnswers)(
    '%s carries a strong entity tag of its bytes and may be kept for five minutes',
    async (path) => {
      const answer = await fetched(path);

      expect(answer.status).toBe(200);
      expect(answer.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/u);
      expect(answer.headers.get('cache-control')).toBe('public, max-age=300');
      expect((await fetched(path)).headers.get('etag')).toBe(answer.headers.get('etag'));
    },
  );

  it.each(publicAnswers)(
    '%s answers 304 with its tag and no body when If-None-Match names it alone, in a list, as a weak tag or as *',
    async (path) => {
      const etag = await entityTagOf(path);
      const named = [etag, `"stale", ${etag}`, `W/${etag}`, '*'];
      const answers = await Promise.all(named.map((ifNoneMatch) => fetched(path, { 'if-none-match': ifNoneMatch })));

      expect(answers.map((answer) => cachingOf(answer))).toEqual(
        named.map(() => [304, etag, 'public, max-age=300', '']),
      );
    },
  );

  it.each(publicAnswers)('%s answers 200 and its bytes when If-None-Match names another tag', async (path) => {
    const etag = await entityTagOf(path);
    const answers = await Promise.all(
      ['"stale"', 'not a tag'].map((ifNoneMatch) => fetched(path, { 'if-none-match': ifNoneMatch })),
    );

    expect(answers.map(({ status, headers, text }) => [status, headers.get('etag'), text === ''])).toEqual([
      [200, etag, false],
      [200, etag, false],
    ]);
  });
});

describe('HEAD on the document', () => {
  it('answers the headers GET answers, and no body, and 304 when its tag is named', async () => {
    const [got, head] = await Promise.all([fetched('/v1/openapi.json'), fetched('/v1/openapi.json', {}, 'HEAD')]);
    const unchanged = await fetched('/v1/openapi.json', { 'if-none-match': String(got.headers.get('etag')) }, 'HEAD');

    expect(cachingOf(head)).toEqual([200, got.headers.get('etag'), 'public, max-age=300', '']);
    expect(head.headers.get('content-type')).toBe('application/json');
    expect(cachingOf(unchanged)).toEqual([304, got.headers.get('etag'), 'public, max-age=300', '']);
  });
});

describe('HEAD on a guide', () => {
  it('answers the headers GET answers, and no body', async () => {
    const [got, head] = await Promise.all([fetched('/v1/guides/notebook'), fetched('/v1/guides/notebook', {}, 'HEAD')]);

    expect(cachingOf(head)).toEqual([200, got.headers.get('etag'), 'public, max-age=300', '']);
    expect(head.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(got.text).not.toBe('');
  });
});
