import { authenticatorFor } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { call, createTestHandler } from '../testing/api-calls.ts';
import { acmeAdmin } from '../testing/operation-server.ts';
import { clientMetadataRoutes, type ClientMetadataDocument } from './client-metadata.ts';

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
