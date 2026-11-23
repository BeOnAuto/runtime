import { afterEach, describe, expect, it } from 'vitest';

import { added, lastFact } from '../testing/additions.ts';
import { ada, harness, operationNamed, recordedAs, type Harness, type HarnessOptions } from '../testing/harness.ts';
import { preparedOf, sourceOver } from '../testing/served-connections.ts';
import {
  appId,
  asTheInstalledApp,
  installation,
  installedAppAt,
  type InstalledApp,
} from '../testing/service-accounts.ts';

const anyWords: unknown = expect.any(String);

const namingTheStatus: unknown = expect.stringContaining('HTTP 401');

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function appAt(): InstalledApp {
  const app = installedAppAt();
  closing.push(app.service.close);
  return app;
}

function harnessOf({ providers }: InstalledApp, changes: HarnessOptions = {}): Harness {
  return harness({ providers, mostSecretCharacters: 4096, ...changes });
}

function giving(h: Harness, input: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'give_credential'), ada, input);
}

function bodyOf(privateKey: string): string {
  return privateKey.split('\n').slice(1, -2).join('');
}

describe('a key file that is the private key itself in PEM, given for a way whose service has a token request of its own', () => {
  it('is added with the client and the address of its token request the values name, then checked with one token asked there, then kept in PKCS #8', async () => {
    const app = appAt();
    const askedWhenKept: number[] = [];
    const h = harnessOf(app, {
      beforeKeeping: () => Promise.resolve(askedWhenKept.push(app.service.tokenRequests())),
    });
    const { id, token } = await added(h, asTheInstalledApp);
    const [recorded] = await h.facts();

    const given = await giving(h, { id, token, key_file: app.pkcs1 });

    expect(recorded?.data).toHaveProperty('credential', {
      kind: 'jwt_bearer',
      permissions: 'application',
      issuer: `${app.service.origin}/apps`,
      client_id: appId,
      token_request: {
        method: 'POST',
        url: `${app.service.origin}/apps/installations/${installation}/tokens`,
        issued: { access_token: '/token', expires_at: '/expires_at' },
      },
    });
    expect(given).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'connected', credential: { kind: 'jwt_bearer', client_id: appId } },
    });
    expect(askedWhenKept).toEqual([1]);
    expect([...h.secrets.values().values()]).toEqual([app.pkcs8]);
    expect(await lastFact(h)).toEqual({
      connection: id,
      secret_id: 'secret-1',
      algorithm: 'RS256',
      client_id: appId,
      connected_by: recordedAs.ada,
    });
  });
});

describe('a connection made through such a way', () => {
  it('is served asking its token at the address of its token request, and its key is in no fact, answer or log', async () => {
    const app = appAt();
    const h = harnessOf(app);
    const { id, token } = await added(h, asTheInstalledApp);

    const given = await giving(h, { id, token, key_file: app.pkcs1 });
    const { settings } = await preparedOf(sourceOver(h, { providers: app.providers }), id);
    const written = JSON.stringify([given, await h.facts(), h.logged()]);

    expect(settings.auth).toMatchObject({
      issuer: `${app.service.origin}/apps`,
      client_id: appId,
      grant: 'jwt_bearer',
      token_request: { url: `${app.service.origin}/apps/installations/${installation}/tokens` },
      credential: { kind: 'private_key', algorithm: 'RS256' },
    });
    expect([bodyOf(app.pkcs1), bodyOf(app.pkcs8)].filter((part) => written.includes(part))).toEqual([]);
  });
});

describe('a key file in PEM the runtime does not keep', () => {
  it('is refused at its field where it is not a private key, asking nothing of the service', async () => {
    const app = appAt();
    const h = harnessOf(app);
    const { id, token } = await added(h, asTheInstalledApp);

    expect(await giving(h, { id, token, key_file: '{"client_email":"robot@acme.example.com"}' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/key_file', detail: anyWords }],
    });
    expect([h.secrets.values().size, app.service.tokenRequests()]).toEqual([0, 0]);
  });

  it('is refused, naming the status the service answers, where the service gives no token for the values given, keeping nothing', async () => {
    const app = appAt();
    const h = harnessOf(app);
    const { id, token } = await added(h, { ...asTheInstalledApp, placeholders: { app: '7654321', installation } });

    expect(await giving(h, { id, token, key_file: app.pkcs1 })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '', detail: namingTheStatus }],
    });
    expect(h.secrets.values().size).toBe(0);
  });
});
