import { toolNamesIn, withMcpSession } from '@on.auto/api/testing';
import { type FakeMcpServer, servedForConsent, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { consentSecret, hostOf } from '@on.auto/tool-servers/testing';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { keptSecretOf, secretIdOf, secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import {
  connectedByConsent,
  consentFinishedBy,
  consentStartedFrom,
  filesProvidedBy,
  type GroupOfMore,
  linkAddedBy,
  servedStudioReturn,
} from '../testing/servers/consents-over-http.ts';
import { noNetwork, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

let crmServer: FakeMcpServer;

function crm() {
  return {
    name: 'crm',
    type: 'mcp',
    entry: { url: crmServer.url },
    credential: {
      kind: 'secret',
      name: 'Authorization',
      in: 'header',
      instructions: 'Make a key in the CRM under **Settings**, [API keys](https://crm.example.com/settings/keys).',
      key_page: 'https://crm.example.com/settings/keys',
    },
  };
}

const byHand = {
  name: 'files',
  type: 'mcp',
  entry: { url: 'https://files.example.com/mcp' },
  credential: { kind: 'authorization', issuer: 'https://accounts.files.example.com' },
};

const issuerByHand = 'Expected no issuer: the server names its authorization server itself';

let server: ReasoningServer;

async function addedCrm() {
  return linkAddedBy(await server.call('POST', connections, { body: crm() }));
}

const anHour = 3_600_000;

const consentEnded =
  'The consent of the connection files was revoked or has ended, so the person who added it reconnects it';

const KeptTokensSchema = Schema.fromJsonString(
  Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
);

async function tokensKeptFor(fileName: string, id: string) {
  const secretId = String(await secretIdOf(fileName, 'local', id));
  return Schema.decodeUnknownSync(KeptTokensSchema)(String((await keptSecretOf(fileName, secretId)).value));
}

function revokedAt(fake: FakeMcpServer, refreshToken: string): Promise<Response> {
  return fetch(`${fake.origin}/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`auto-runtime:${consentSecret}`)}`,
    },
    body: new URLSearchParams({ token: refreshToken }),
  });
}

function echoing(served: ReasoningServer) {
  return served.call('POST', '/v1/orgs/local/playbooks/alpha/tool-servers/files/tools/echo/execute', {
    body: { arguments: { said: 'hi' } },
  });
}

const sharing: GroupOfMore = {
  name: 'share',
  for: 'Share your files with other people.',
  scope: 'files.share',
  says: { 'files.share': 'Share the files of the account with other people.' },
};

const offeredGroup = { name: sharing.name, for: sharing.for };

const filesOffered: unknown = expect.arrayContaining([
  { name: 'files', title: 'Files', description: 'Read the files of an account.', more: [offeredGroup] },
]);

async function servedWithTheGroup(): Promise<ReasoningServer> {
  const { port, returnAddress } = await servedStudioReturn();
  const fake = await servedForConsent({ redirectUris: [returnAddress] });
  const served = await servingReasoning([], { PORT: String(port), ...filesProvidedBy(fake, [sharing]) });
  onTestFinished(async () => {
    await served.stop();
    await fake.close();
  });
  return served;
}

const ConnectSchema = Schema.Struct({ connect: Schema.Struct({ url: Schema.String }) });

const AddedSchema = Schema.Struct({ id: Schema.String });

interface StoppingOnce {
  (): Promise<void>;
  readonly server: ReasoningServer;
}

function stoppingOnce(serverSecondStarts: ReasoningServer): StoppingOnce {
  const stopping: { done?: Promise<void> } = {};
  return Object.assign(
    () => {
      stopping.done ??= serverSecondStarts.stop();
      return stopping.done;
    },
    { server: serverSecondStarts },
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

describe('consent over http', () => {
  beforeAll(async () => {
    server = await servingReasoning([], { SECRETS_KEY: secretsKey.toString('base64') });
    crmServer = await serveFakeMcp({ bearer: 'crm-token' });
  });

  afterAll(async () => {
    await server.stop();
    await crmServer.close();
  });

  describe('the start and the finish of a consent over HTTP', () => {
    it('are routes of the org bound to the link, refusing a connection that takes no consent and an unknown token', async () => {
      const { id, token } = await addedCrm();
      const finishing = { token, code: 'a-code', state: 'a-state' };

      const [started, finished, unknown] = [
        await server.call('POST', `${connections}/${id}/consent`, { body: { token } }),
        await server.call('POST', `${connections}/${id}/consent/code`, { body: finishing }),
        await server.call('POST', `${connections}/${id}/consent`, { body: { token: 'unknown' } }),
      ];

      expect([started, finished]).toMatchObject([
        {
          status: 409,
          body: {
            reason: 'conflict',
            detail:
              'The connection crm is not connected by signing in to its provider, so it has no consent to start or finish',
          },
        },
        { status: 409, body: { reason: 'conflict' } },
      ]);
      expect(unknown).toMatchObject({ status: 404, body: { reason: 'not_found' } });
    });

    it('are served to no agent, as the other routes of the link are not', async () => {
      const tools = await withMcpSession(
        'current revision',
        { url: `${server.origin}/mcp`, headers: {} },
        async (session) => toolNamesIn(await session.listTools()),
      );

      expect(tools.filter((name) => ['start', 'finish'].includes(name))).toEqual([]);
    });
  });

  describe('a connection of consent given by hand', () => {
    it('is refused over HTTP and over MCP at the issuer it gives beside its kind, which the input takes by its name', async () => {
      const overHttp = await server.call('POST', connections, { body: byHand });
      const overMcp = await withMcpSession(
        'current revision',
        { url: `${server.origin}/mcp`, headers: {} },
        (session) => session.callTool('add_connection', byHand),
      );

      expect(overHttp).toMatchObject({
        status: 422,
        body: { reason: 'invalid_input', errors: [{ pointer: '/credential/issuer', detail: issuerByHand }] },
      });
      expect(overMcp).toMatchObject({ isError: true });
      expect(JSON.stringify(overMcp)).toContain(issuerByHand);
    });
  });

  describe('a connection connected by consent over HTTP', () => {
    it('calls a tool with its access token, is renewed once it is due and broken once its grant is revoked', async () => {
      const { port, returnAddress } = await servedStudioReturn();
      const fake = await servedForConsent({ redirectUris: [returnAddress] });
      const ledger = temporaryLedger();
      const clock = movedClock(Date.now());
      const served = await servingReasoning(
        [],
        {
          PORT: String(port),
          LEDGER_FILE: ledger.fileName,
          SECRETS_KEY: secretsKey.toString('base64'),
          ...filesProvidedBy(fake),
        },
        noNetwork,
        { clock },
      );
      onTestFinished(async () => {
        await served.stop();
        await fake.close();
        ledger.remove();
      });
      await served.call('POST', '/v1/orgs/local/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      const id = await connectedByConsent(served);
      const first = await tokensKeptFor(ledger.fileName, id);

      const called = await echoing(served);
      clock.moveTo(clock.now() + anHour);
      const renewedCall = await echoing(served);
      const renewed = await tokensKeptFor(ledger.fileName, id);
      await revokedAt(fake, renewed.refresh_token);
      const refused = await echoing(served);
      const read = await served.call('GET', `${connections}/${id}`);

      expect([called.body, renewedCall.body]).toMatchObject([{ outcome: 'result' }, { outcome: 'result' }]);
      expect(renewed.access_token).not.toBe(first.access_token);
      expect(fake.seen().map(({ authorization }) => authorization)).toEqual(
        expect.arrayContaining([`Bearer ${first.access_token}`, `Bearer ${renewed.access_token}`]),
      );
      expect(refused.body).not.toMatchObject({ outcome: 'result' });
      expect(read.body).toMatchObject({ status: 'broken', broken: { kind: 'consent_ended', detail: consentEnded } });
      expect(JSON.stringify([called.body, renewedCall.body, refused.body, read.body])).not.toContain(
        renewed.refresh_token,
      );
    });
  });
});

describe('a connection connected by consent, to a provider whose way names a group of more', () => {
  it('is offered the group by the search and by its record, and is granted the scopes of both consents once the person allows it', async () => {
    const served = await servedWithTheGroup();

    const searched = await served.call('GET', '/v1/orgs/local/tool-servers/search');
    const id = await connectedByConsent(served);
    const connected = await served.call('GET', `${connections}/${id}`);
    const link = linkAddedBy(await served.call('POST', `${connections}/${id}/link`, { body: { more: sharing.name } }));
    const started = await consentStartedFrom(served, link);
    await consentFinishedBy(served, link, started.authorize.href);
    const allowed = await served.call('GET', `${connections}/${id}`);
    const askedAgain = await served.call('POST', `${connections}/${id}/link`, { body: { more: sharing.name } });

    expect(searched).toMatchObject({ status: 200, body: { providers: filesOffered } });
    expect(connected).toMatchObject({
      status: 200,
      body: { status: 'connected', granted_scope: 'files.read', more: [offeredGroup] },
    });
    expect(started.authorize.searchParams.get('scope')).toBe('files.read files.share');
    expect(allowed).toMatchObject({
      status: 200,
      body: {
        status: 'connected',
        granted_scope: 'files.read files.share',
        asked_scopes: [
          { name: 'files.read', says: 'Read the files of the account.' },
          { name: 'files.share', says: sharing.says['files.share'] },
        ],
        more: [],
      },
    });
    expect(askedAgain).toMatchObject({ status: 409, body: { reason: 'conflict' } });
  });
});

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
