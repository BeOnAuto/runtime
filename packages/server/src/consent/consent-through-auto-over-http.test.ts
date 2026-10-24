import { servedThroughAuto, type ThroughAuto } from '@on.auto/tool-servers/served-fakes';
import { handleOf } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { secretsKey } from '../testing/records/kept-credentials.ts';
import { consentStartedBy } from '../testing/servers/consents-over-http.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

type Environment = Readonly<Record<string, string>>;

const ListedSchema = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({ name: Schema.String, credentials: Schema.Array(Schema.Struct({ offered: Schema.Boolean })) }),
  ),
});

function filesAt({ fake }: Pick<ThroughAuto, 'fake'>): Environment {
  return {
    CONNECTIONS: JSON.stringify({
      providers: [
        {
          name: 'files',
          title: 'Files',
          description: 'Read the files of an account.',
          website: 'https://developer.files.example.com',
          type: 'mcp',
          url: fake.url,
          credentials: [{ kind: 'authorization', issuer: fake.origin, scope: 'files.read' }],
        },
      ],
    }),
  };
}

async function throughAuto(): Promise<ThroughAuto> {
  const serving = await servedThroughAuto();
  onTestFinished(serving.close);
  return serving;
}

async function servedWith(environment: Environment): Promise<ReasoningServer> {
  const served = await servingReasoning([], { SECRETS_KEY: secretsKey.toString('base64'), ...environment });
  onTestFinished(served.stop);
  return served;
}

async function filesOfferedBy(served: ReasoningServer): Promise<readonly boolean[]> {
  const { body } = await served.call('GET', '/v1/orgs/local/providers');
  const { providers } = Schema.decodeUnknownSync(ListedSchema)(body);
  return providers
    .filter(({ name }) => name === 'files')
    .flatMap(({ credentials }) => credentials.map(({ offered }) => offered));
}

function throughTheService(serving: ThroughAuto): Environment {
  return { AUTO_CLIENTS: 'true', CONSENT_SERVICE_URL: serving.service.url, ...filesAt(serving) };
}

describe('a provider of consent on a runtime in local mode', () => {
  it('is offered through Auto’s consent service where AUTO_CLIENTS is on, and set up first where it is off', async () => {
    const serving = await throughAuto();

    const on = await servedWith(throughTheService(serving));
    const off = await servedWith({ ...throughTheService(serving), AUTO_CLIENTS: 'false' });

    expect([await filesOfferedBy(on), await filesOfferedBy(off)]).toEqual([[true], [false]]);
  });
});

describe('a consent through Auto’s consent service over HTTP', () => {
  it('starts from the served Studio on this computer, is finished with the handle, and connects the connection', async () => {
    const serving = await throughAuto();
    const served = await servedWith(throughTheService(serving));

    const { id, token, authorize } = await consentStartedBy(served);
    const read = await served.call('GET', `${connections}/${id}/link/${token}`);
    const finished = await served.call('POST', `${connections}/${id}/consent/code`, {
      body: {
        token,
        state: String(authorize.searchParams.get('state')),
        handle: await handleOf(serving.service, authorize.href),
      },
    });

    expect(read.body).toMatchObject({ client_source: 'auto' });
    expect(serving.service.calls().find(({ path }) => path === '/consents')?.body).toMatchObject({
      return: { kind: 'loopback', base: `${served.origin}/studio/` },
    });
    expect(finished).toMatchObject({
      status: 200,
      body: { status: 'connected', credential: { client_id: 'auto-runtime', client_source: 'auto' } },
    });
  });
});

describe('a runtime whose consent service is named on http off the loopback', () => {
  it('does not start, naming the setting', async () => {
    const starting = startServer(
      { HOST: '127.0.0.1', PORT: '0', CONSENT_SERVICE_URL: 'http://consent.example.com' },
      compositionRoot,
    );

    await expect(starting).rejects.toThrow(
      'CONSENT_SERVICE_URL: Expected an https URL; an http URL is taken only for localhost, 127.0.0.1, or [::1]',
    );
  });
});
