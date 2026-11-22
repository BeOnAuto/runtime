import { createHash, randomBytes } from 'node:crypto';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeGatewayInProcess, inProcessFetch } from '../testing/index.ts';
import { gatewayDocumentOf, type FakeGateway, type FakeGatewayOptions } from '../testing/served-fakes.ts';
import { connectionGatewayBehaviour } from './connection-gateway-behaviour.ts';
import { fakeGatewayAnswers } from './fake-gateway.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function served(options: FakeGatewayOptions = {}): FakeGateway {
  const gateway = fakeGatewayInProcess(options);
  closing.push(gateway.close);
  return gateway;
}

function posted(url: string, body: unknown): Promise<Response> {
  return inProcessFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const verifier = randomBytes(32).toString('base64url');

const challenge = createHash('sha256').update(verifier).digest('base64url');

const state = randomBytes(32).toString('base64url');

const startedOf = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

const handedOf = Schema.decodeUnknownSync(Schema.Struct({ connection_key: Schema.String }));

async function keyOf(gateway: FakeGateway): Promise<string> {
  const { url } = startedOf(await (await posted(gateway.url, { challenge, challenge_method: 'S256', state })).json());
  const { handle } = gateway.allow(url);
  return handedOf(await (await posted(`${gateway.url}/handoffs/${handle}`, { verifier })).json()).connection_key;
}

describe('the fake gateway', () => {
  it('serves its document, whose calls take the key in the header it names', async () => {
    const gateway = served({ keyHeader: 'X-Key' });

    const document = await (await inProcessFetch(gateway.document)).json();

    expect(document).toEqual(gatewayDocumentOf(gateway.origin, 'X-Key'));
    expect(gateway.keyHeader).toBe('X-Key');
  });

  it('answers a call that carries a key it handed over, and refuses one without it as a connection whose access ended', async () => {
    const gateway = served();
    const key = await keyOf(gateway);

    const statuses = [
      (await inProcessFetch(`${gateway.origin}/api/whoami`, { headers: { [gateway.keyHeader]: key } })).status,
      (await inProcessFetch(`${gateway.origin}/api/whoami`)).status,
      (await inProcessFetch(`${gateway.origin}/api/whoami`, { headers: { [gateway.keyHeader]: 'unknown' } })).status,
    ];

    expect(statuses).toEqual([200, 401, 401]);
  });

  it('refuses a start of another method or with a state of another shape, and knows no other address', async () => {
    const gateway = served();

    const statuses = [
      (await posted(gateway.url, { challenge, challenge_method: 'plain', state })).status,
      (await posted(gateway.url, { challenge, challenge_method: 'S256', state: 'short' })).status,
      (await posted(gateway.url, 'not a start')).status,
      (await inProcessFetch(gateway.url)).status,
      (await posted(`${gateway.origin}/elsewhere`, {})).status,
      (await posted(`${gateway.url}/remove`, 'not a key')).status,
    ];

    expect(statuses).toEqual([400, 400, 400, 404, 404, 403]);
  });

  it('answers a step as it is told to until it is told to answer as itself again', async () => {
    const gateway = served();
    gateway.answering('call', 503);
    const told = (await inProcessFetch(`${gateway.origin}/api/whoami`)).status;
    gateway.answeringAsItself('call');

    expect([told, (await inProcessFetch(`${gateway.origin}/api/whoami`)).status]).toEqual([503, 401]);
  });
});

connectionGatewayBehaviour('the fake', () => {
  const origin = 'https://gateway.example';
  const answers = fakeGatewayAnswers();
  const gateway = answers.gatewayAt({ origin, heard: () => [], failures: () => [], close: () => Promise.resolve() });
  return Promise.resolve({
    handler: answers.handlerAt(origin),
    connections: gateway.url,
    calls: `${origin}/api`,
    keyHeader: gateway.keyHeader,
    aCall: { method: 'GET', path: '/whoami' },
    noted: () => Promise.resolve({}),
    consentAt: (startUrl) => Promise.resolve(gateway.allow(startUrl).handle),
  });
});
