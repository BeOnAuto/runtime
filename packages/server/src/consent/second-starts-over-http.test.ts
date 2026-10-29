import { servedForConsent, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { hostOf } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { connectedByConsent, servedStudioReturn } from '../testing/servers/consents-over-http.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

const ConnectSchema = Schema.Struct({ connect: Schema.Struct({ url: Schema.String }) });

const AddedSchema = Schema.Struct({ id: Schema.String });

interface StoppingOnce {
  (): Promise<void>;
  readonly server: ReasoningServer;
}

function stoppingOnce(server: ReasoningServer): StoppingOnce {
  const stopping: { done?: Promise<void> } = {};
  return Object.assign(
    () => {
      stopping.done ??= server.stop();
      return stopping.done;
    },
    { server },
  );
}

const registersOnceInAWhile = {
  dynamicRegistration: true,
  takesPublicClientsAlone: true,
  registrationSecretSeconds: -60,
  registrationsBeforeTheLimit: 1,
  registrationRetryAfter: '600',
};

function registeringFilesAt(fake: FakeMcpServer): Readonly<Record<string, string>> {
  return {
    CONNECTIONS: JSON.stringify({
      allowed_hosts: ['127.0.0.1'],
      providers: [
        {
          name: 'files',
          title: 'Files',
          description: 'Read the files of an account.',
          website: 'https://developer.files.example.com',
          type: 'mcp',
          url: fake.url,
          credentials: [
            {
              kind: 'authorization',
              issuer: fake.origin,
              scope: 'files.read',
              says: { 'files.read': 'Read the files of the account.' },
              clients: ['dynamic'],
            },
          ],
        },
      ],
    }),
  };
}

function registrationsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/register').length;
}

function tokenOf(body: unknown): string {
  return String(new URL(Schema.decodeUnknownSync(ConnectSchema)(body).connect.url).searchParams.get('token'));
}

describe('a second start of a connection connected by consent, at a server that registers a client once in a while', () => {
  it('takes the client registered for the first consent, at once and after a restart, and the connection stays connected', async () => {
    const { port, returnAddress } = await servedStudioReturn();
    const fake = await servedForConsent({ redirectUris: [returnAddress], ...registersOnceInAWhile });
    const ledger = temporaryLedger();
    const environment = {
      PORT: String(port),
      LEDGER_FILE: ledger.fileName,
      SECRETS_KEY: secretsKey.toString('base64'),
      ...registeringFilesAt(fake),
    };
    onTestFinished(async () => {
      await fake.close();
      ledger.remove();
    });
    const stopServed = stoppingOnce(await servingReasoning([], environment));
    onTestFinished(stopServed);
    const served = stopServed.server;
    const id = await connectedByConsent(served, { provider: 'files' });

    const token = tokenOf((await served.call('POST', `${connections}/${id}/link`)).body);
    const atOnce = await served.call('POST', `${connections}/${id}/consent`, { body: { token } });
    await stopServed();
    const restarted = await servingReasoning([], environment);
    onTestFinished(restarted.stop);
    const afterARestart = await restarted.call('POST', `${connections}/${id}/consent`, { body: { token } });
    const read = await restarted.call('GET', `${connections}/${id}/link/${token}`);

    expect([atOnce, afterARestart]).toMatchObject(
      Array.from({ length: 2 }, () => ({ status: 201, body: { client_source: 'dynamic' } })),
    );
    expect(registrationsAt(fake)).toBe(1);
    expect(read).toMatchObject({ status: 200, body: { status: 'connected' } });
  });
});

describe('a start at a server that registers a client once in a while, from a runtime that has not registered one', () => {
  it('is refused where the server must register a client past its limit, in words that name the host, the step, the status and the wait', async () => {
    const { port, returnAddress } = await servedStudioReturn();
    const fake = await servedForConsent({ redirectUris: [returnAddress], ...registersOnceInAWhile });
    const environment = { PORT: String(port), SECRETS_KEY: secretsKey.toString('base64'), ...registeringFilesAt(fake) };
    onTestFinished(fake.close);
    const stopFirst = stoppingOnce(await servingReasoning([], environment));
    onTestFinished(stopFirst);
    await connectedByConsent(stopFirst.server, { provider: 'files' });
    await stopFirst();
    const another = await servingReasoning([], environment);
    onTestFinished(another.stop);

    const added = await another.call('POST', connections, { body: { provider: 'files' } });
    const { id } = Schema.decodeUnknownSync(AddedSchema)(added.body);
    const started = await another.call('POST', `${connections}/${id}/consent`, {
      body: { token: tokenOf(added.body) },
    });

    expect(started).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: `The consent of the connection files cannot go on: ${hostOf(fake)} answered the registration of a client with HTTP 429; try again in 10 minutes`,
      },
    });
  });
});
