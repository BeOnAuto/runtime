import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import { authenticatorFor, identityServiceOf, signInScopes, type IssuerRequests } from '@on.auto/identity';
import { fakeIssuer, hostedStudio, type Claims, type FakeClient, type FakeIssuer } from '@on.auto/identity/testing';
import { Schema } from 'effect';

import type { ApiHandler } from '../index.ts';
import { acmeAdmin, acmeAlphaWriter, operationServer, type OperationServer } from './operation-server.ts';

export const publicUrl = 'https://runtime.example';

export const allowedOrigin = 'https://app.example';

type RequestHeaders = Readonly<Record<string, string>>;

export interface SignedIn {
  readonly server: OperationServer;
  readonly issuer: FakeIssuer;
  readonly bearer: (claims?: Claims) => Promise<RequestHeaders>;
  readonly fromPage: (page: string, claims?: Claims) => Promise<RequestHeaders>;
}

async function serverOf(issuer: FakeIssuer, resource: string, requests: IssuerRequests): Promise<OperationServer> {
  const allowedOrigins = [allowedOrigin];
  const identityService = await identityServiceOf(
    { issuer: issuer.issuer, publicUrl: resource, studio: hostedStudio, allowedOrigins },
    requests,
  );
  return operationServer({
    authenticator: authenticatorFor({
      host: '0.0.0.0',
      apiKeys: [acmeAdmin.entry, acmeAlphaWriter.entry],
      identityService,
    }),
    allowedOrigins,
  });
}

export async function signedInServer(): Promise<SignedIn> {
  const issuer = fakeIssuer('https://login.example');
  const server = await serverOf(issuer, publicUrl, { fetch: issuer.answer, now: Date.now });
  const seconds = Math.floor(Date.now() / 1000);
  return {
    server,
    issuer,
    bearer: async (claims = {}) => ({
      authorization: `Bearer ${await issuer.sign({
        iss: issuer.issuer,
        sub: 'ada',
        name: 'Ada Lovelace',
        aud: publicUrl,
        iat: seconds,
        exp: seconds + 300,
        org_id: 'acme',
        scope: signInScopes.join(' '),
        ...claims,
      })}`,
    }),
    fromPage: async (page, claims = {}) => ({
      origin: page,
      authorization: `Bearer ${await issuer.session(page, claims)}`,
    }),
  };
}

export interface OnLoopback<T> {
  readonly origin: string;
  readonly served: T;
  readonly close: () => Promise<void>;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function listened(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${portOf(server.address()).port}`;
}

async function closed(server: Server): Promise<void> {
  const ended = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await ended;
}

export async function issuerOnLoopback(clients: Readonly<Record<string, FakeClient>>): Promise<OnLoopback<FakeIssuer>> {
  const issuer = Promise.withResolvers<FakeIssuer>();
  const listener = getRequestListener(async (request: Request) => (await issuer.promise).answer(request));
  const server = createServer((incoming, outgoing) => {
    void listener(incoming, outgoing);
  });
  const origin = await listened(server);
  issuer.resolve(fakeIssuer(origin, { clients, metadata: { jwks_uri: 'https://keys.example/jwks' } }));
  return { origin, served: await issuer.promise, close: () => closed(server) };
}

export async function signedInOnLoopback(issuer: FakeIssuer): Promise<OnLoopback<OperationServer>> {
  const handler = Promise.withResolvers<ApiHandler>();
  const server = createServer((incoming, outgoing) => {
    void handler.promise.then((served) => served.listener(incoming, outgoing));
  });
  const origin = await listened(server);
  const operations = await serverOf(issuer, origin, { fetch: issuer.answer, now: Date.now });
  handler.resolve(operations.handler);
  return {
    origin,
    served: operations,
    close: async () => {
      await closed(server);
      await operations.handler.close();
    },
  };
}
