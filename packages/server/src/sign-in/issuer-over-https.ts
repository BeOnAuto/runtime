import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';

import { fakeIssuer, type FakeIssuer, type FakeIssuerOptions } from '@on.auto/identity/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { aCertificateOfTheLoopback, trustedForTheTest } from '../testing/databases/loopback-certificate.ts';

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function answered(
  issuer: Promise<FakeIssuer>,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const fake = await issuer;
  const answer = await fake.answer(new Request(new URL(String(incoming.url), fake.issuer)));
  outgoing.writeHead(answer.status, Object.fromEntries(answer.headers));
  outgoing.end(await answer.text());
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

export async function issuerOverHttps(options: FakeIssuerOptions = {}): Promise<FakeIssuer> {
  const certificate = aCertificateOfTheLoopback();
  trustedForTheTest(certificate);
  const issuer = Promise.withResolvers<FakeIssuer>();
  const server = createServer(certificate, (incoming, outgoing) => {
    void answered(issuer.promise, incoming, outgoing);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.close();
    server.closeAllConnections();
  });
  issuer.resolve(fakeIssuer(`https://127.0.0.1:${portOf(server.address()).port}`, options));
  return issuer.promise;
}
