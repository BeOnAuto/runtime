import { once } from 'node:events';
import { createServer } from 'node:net';

import { signInScopes } from '@on.auto/identity';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { tcpPort } from '../lifecycle/http-server.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { type RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { accessTokenOf, issuerOverHttps } from './issuer-over-https.ts';

async function aPortNothingListensOn(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = tcpPort(probe.address());
  probe.close();
  await once(probe, 'close');
  return port;
}

async function startedOn(port: number, environment: Readonly<Record<string, string>>): Promise<RunningServer> {
  const ledger = temporaryLedger();
  const server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: String(port),
      LEDGER_FILE: ledger.fileName,
      PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      ...environment,
    },
    compositionRoot,
  );
  onTestFinished(async () => {
    await server.stop();
    ledger.remove();
  });
  return server;
}

async function statusOfPlaybooks(port: number, token: string): Promise<number> {
  const answer = await fetch(`http://127.0.0.1:${port}/v1/orgs/acme/playbooks`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return answer.status;
}

describe('a runtime on its own loopback address', () => {
  it('signs no one in without PUBLIC_URL, serves no metadata and takes a request as the local developer', async () => {
    const server = await startedOn(await aPortNothingListensOn(), {});
    const metadata = await fetch(`http://127.0.0.1:${server.port}/.well-known/oauth-protected-resource`);
    const playbooks = await fetch(`http://127.0.0.1:${server.port}/v1/orgs/local/playbooks`);

    expect(server.signIn).toBeUndefined();
    expect([metadata.status, playbooks.status]).toEqual([404, 200]);
  });

  it('signs people in with PUBLIC_URL set to http://localhost and its port, the audience their tokens name', async () => {
    const issuer = await issuerOverHttps();
    const port = await aPortNothingListensOn();
    const ownAddress = `http://localhost:${port}`;

    const server = await startedOn(port, { IDENTITY_ISSUER: issuer.issuer, PUBLIC_URL: ownAddress });
    const metadata = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`);
    const refused = await fetch(`http://127.0.0.1:${port}/v1/orgs/acme/playbooks`);
    const forItsAddress = await accessTokenOf(issuer, ownAddress, signInScopes.join(' '));
    const forAnotherAddress = await accessTokenOf(issuer, 'http://localhost:1', signInScopes.join(' '));

    expect(server.signIn).toEqual({ issuer: issuer.issuer, publicUrl: ownAddress });
    expect(await metadata.json()).toMatchObject({
      resource: `${ownAddress}/mcp`,
      authorization_servers: [issuer.issuer],
    });
    expect([await statusOfPlaybooks(port, forItsAddress), await statusOfPlaybooks(port, forAnotherAddress)]).toEqual([
      200, 401,
    ]);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${ownAddress}/.well-known/oauth-protected-resource", scope="${signInScopes.join(' ')}"`,
    );
  });
});

const everySignInScope = signInScopes.join(' ');

describe('a runtime given the key set of its identity service', () => {
  it('reads nothing of the service at start with IDENTITY_JWKS, and admits a token signed with a key of the set', async () => {
    const issuer = await issuerOverHttps();
    const keySet = await (await issuer.answer(new Request(`${issuer.issuer}/jwks`))).text();
    const port = await aPortNothingListensOn();
    const ownAddress = `http://localhost:${port}`;

    await startedOn(port, { IDENTITY_ISSUER: issuer.issuer, IDENTITY_JWKS: keySet, PUBLIC_URL: ownAddress });

    expect(await statusOfPlaybooks(port, await accessTokenOf(issuer, ownAddress, everySignInScope))).toBe(200);
    expect(issuer.keySetReads()).toBe(1);
  });

  it('reads the key set at IDENTITY_JWKS_URL, and not the metadata, which names another', async () => {
    const issuer = await issuerOverHttps({ metadata: { jwks_uri: 'http://127.0.0.1/jwks' } });
    const port = await aPortNothingListensOn();
    const ownAddress = `http://localhost:${port}`;

    await startedOn(port, {
      IDENTITY_ISSUER: issuer.issuer,
      IDENTITY_JWKS_URL: `${issuer.issuer}/jwks`,
      PUBLIC_URL: ownAddress,
    });

    expect(await statusOfPlaybooks(port, await accessTokenOf(issuer, ownAddress, everySignInScope))).toBe(200);
    expect(issuer.keySetReads()).toBe(1);
  });
});
