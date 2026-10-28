import { serveFakeMcp, servedForConsent, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { describe, expect, it, onTestFinished } from 'vitest';

import { connectionFactsIn, secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import {
  connectedByConsent,
  filesProvidedBy,
  linkAddedBy,
  servedStudioReturn,
} from '../testing/servers/consents-over-http.ts';
import { connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const keyRefused =
  'The tool server answered HTTP 401: it refused the credential the connection holds, so the person who added it reconnects it';

const clientSecret = 'billing-client-secret-3a9f71';

interface Serving {
  readonly server: ReasoningServer;
  readonly ledger: TemporaryLedger;
}

async function servingOver(fake: FakeMcpServer, environment: Readonly<Record<string, string>>): Promise<Serving> {
  const ledger = temporaryLedger();
  const server = await servingReasoning(
    [],
    { SECRETS_KEY: secretsKey.toString('base64'), ...connectionsOnLoopback, ...environment },
    noNetwork,
    {
      ledger,
    },
  );
  onTestFinished(async () => {
    await server.stop();
    await fake.close();
    ledger.remove();
  });
  await server.call('POST', '/v1/orgs/local/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return { server, ledger };
}

function echoing(server: ReasoningServer, name: string) {
  return server.call('POST', `/v1/orgs/local/playbooks/alpha/tool-servers/${name}/tools/echo/execute`, {
    body: { arguments: { said: 'hi' } },
  });
}

function callsAt(fake: FakeMcpServer): number {
  return fake.seen().filter(({ rpc }) => rpc === 'tools/call').length;
}

async function refusedTwiceAfterACall({ server, ledger }: Serving, fake: FakeMcpServer, name: string, id: string) {
  const answered = await echoing(server, name);
  const [tokensBefore, callsBefore] = [fake.tokenRequests(), callsAt(fake)];
  fake.answerNextOf('tools/call', 401, 2);
  const refused = await echoing(server, name);
  return {
    answered: answered.body,
    refused: refused.body,
    tokensAsked: fake.tokenRequests() - tokensBefore,
    callsSent: callsAt(fake) - callsBefore,
    standing: (await server.call('GET', `/v1/orgs/local/connections/${id}`)).body,
    breaks: (await connectionFactsIn(ledger.fileName, 'local')).filter((type) => type === 'connection_broken'),
  };
}

function brokenOnce(name: string) {
  return {
    answered: { outcome: 'result' },
    refused: { outcome: 'server_failure', text: `The tool server ${name} failed: ${keyRefused}` },
    tokensAsked: 1,
    callsSent: 2,
    standing: { status: 'broken', broken: keyRefused },
    breaks: ['connection_broken'],
  };
}

describe('a connection of client credentials whose server answers 401 to its token', () => {
  it('asks for a new token and tries once more, and is broken by the second 401, recorded once', async () => {
    const fake = await serveFakeMcp({ client: { clientId: 'billing', clientSecret, expiresInSeconds: 3600 } });
    const serving = await servingOver(fake, {});
    const { id, token } = linkAddedBy(
      await serving.server.call('POST', '/v1/orgs/local/connections', {
        body: {
          name: 'billing',
          type: 'mcp',
          entry: { url: fake.url },
          credential: { kind: 'client_credentials', issuer: fake.origin, client_id: 'billing' },
        },
      }),
    );
    await serving.server.call('POST', `/v1/orgs/local/connections/${id}/credential`, {
      body: { token, client_secret: clientSecret },
    });

    expect(await refusedTwiceAfterACall(serving, fake, 'billing', id)).toMatchObject(brokenOnce('billing'));
  });
});

describe('a connection connected by consent whose server answers 401 to its token', () => {
  it('renews its tokens and tries once more, and is broken by the second 401, recorded once', async () => {
    const { port, returnAddress } = await servedStudioReturn();
    const fake = await servedForConsent({ redirectUris: [returnAddress] });
    const serving = await servingOver(fake, { PORT: String(port), ...filesProvidedBy(fake) });
    const id = await connectedByConsent(serving.server);

    expect(await refusedTwiceAfterACall(serving, fake, 'files', id)).toMatchObject(brokenOnce('files'));
  });
});
