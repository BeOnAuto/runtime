import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { text } from 'node:stream/consumers';

import { fakeIssuer, type FakeIssuer, type FakeIssuerOptions } from '@on.auto/identity/testing';
import { fakeProvider, type FakeProvider, type FakeProviderOptions } from '@on.auto/openid-connect/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { aCertificateOfTheLoopback, trustedForTheTest } from '../testing/databases/loopback-certificate.ts';

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

interface Answering {
  readonly issuer: string;
  readonly answer: (request: Readonly<Request>) => Promise<Response>;
}

function headersOf({ rawHeaders }: IncomingMessage): Headers {
  return new Headers(
    rawHeaders.flatMap((value, at): [string, string][] => (at % 2 === 0 ? [[value, String(rawHeaders[at + 1])]] : [])),
  );
}

async function requestOf(incoming: IncomingMessage, issuer: string): Promise<Request> {
  const method = String(incoming.method);
  const body = method === 'POST' ? await text(incoming) : null;
  return new Request(new URL(String(incoming.url), issuer), { method, headers: headersOf(incoming), body });
}

async function answered(
  served: Promise<Answering>,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const fake = await served;
  const answer = await fake.answer(await requestOf(incoming, fake.issuer));
  outgoing.writeHead(answer.status, Object.fromEntries(answer.headers));
  outgoing.end(await answer.text());
}

async function servedOverHttps<Served extends Answering>(made: (origin: string) => Served): Promise<Served> {
  const certificate = aCertificateOfTheLoopback();
  trustedForTheTest(certificate);
  const served = Promise.withResolvers<Served>();
  const server = createServer(certificate, (incoming, outgoing) => {
    void answered(served.promise, incoming, outgoing);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.close();
    server.closeAllConnections();
  });
  served.resolve(made(`https://127.0.0.1:${portOf(server.address()).port}`));
  return served.promise;
}

export function accessTokenOf(issuer: FakeIssuer, audience: string, scope: string): Promise<string> {
  const seconds = Math.floor(Date.now() / 1000);
  return issuer.sign({
    iss: issuer.issuer,
    sub: 'user|ada',
    name: 'Ada Lovelace',
    aud: audience,
    iat: seconds,
    exp: seconds + 300,
    org_id: 'acme',
    scope,
  });
}

export function issuerOverHttps(options: FakeIssuerOptions = {}): Promise<FakeIssuer> {
  return servedOverHttps((origin) => fakeIssuer(origin, options));
}

export function providerOverHttps(path: string, options: FakeProviderOptions = {}): Promise<FakeProvider> {
  return servedOverHttps((origin) => fakeProvider(`${origin}${path}`, options));
}
