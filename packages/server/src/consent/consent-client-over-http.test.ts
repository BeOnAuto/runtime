import { signInScopes } from '@on.auto/identity';
import { audiences } from '@on.auto/providers/testing';
import {
  consentRegistration,
  consentSecret,
  serveFakeApi,
  serveFakeMcp,
  type FakeApiServer,
  type FakeMcpServer,
} from '@on.auto/tool-servers/testing';
import { Option } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accessTokenOf, issuerOverHttps } from '../sign-in/issuer-over-https.ts';
import { secretsKey } from '../testing/records/kept-credentials.ts';
import { connectedByConsent, consentStartedBy, servedStudioReturn } from '../testing/servers/consents-over-http.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const runtimeAddress = 'https://runtime.example.com';

const documentAddress = `${runtimeAddress}/oauth/client.json`;

const sealing = { SECRETS_KEY: secretsKey.toString('base64') };

type Environment = Readonly<Record<string, string>>;

function documentedAt(fake: FakeMcpServer): Environment {
  const way = { kind: 'authorization', issuer: fake.origin, scope: 'files.read', clients: ['metadata_document'] };
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
          credentials: [way],
        },
      ],
    }),
  };
}

interface SignedIn {
  readonly served: ReasoningServer;
  readonly key: string;
}

async function signedInAt(publicUrl: string, environment: Environment): Promise<SignedIn> {
  const issuer = await issuerOverHttps();
  const served = await servingReasoning([], {
    IDENTITY_ISSUER: issuer.issuer,
    PUBLIC_URL: publicUrl,
    ...sealing,
    ...environment,
  });
  onTestFinished(served.stop);
  return { served, key: await accessTokenOf(issuer, publicUrl, signInScopes.join(' ')) };
}

async function documentingFake(returnAddress: string): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({
    client: consentRegistration({ redirectUris: [returnAddress], clientMetadataDocuments: true }),
  });
  onTestFinished(fake.close);
  return fake;
}

function documentHolding(returnAddress: string) {
  return {
    client_id: documentAddress,
    client_name: 'Auto Runtime',
    redirect_uris: [returnAddress],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'none',
  };
}

const studios: readonly (readonly [string, Environment, string])[] = [
  ['on the Studio host', {}, 'https://studio.on.auto/connect-return'],
  ['on the Studio the runtime serves', { SERVE_STUDIO: 'true' }, `${runtimeAddress}/studio/connect-return`],
];

describe('the client metadata document over HTTP', () => {
  it.each(studios)(
    'is answered without a key and with one where PUBLIC_URL is https, naming the client a consent %s asks with',
    async (_, studio, returnAddress) => {
      const fake = await documentingFake(returnAddress);
      const signedIn = await signedInAt(runtimeAddress, { ...documentedAt(fake), ...studio });

      const withoutKey = await signedIn.served.call('GET', '/oauth/client.json');
      const withKey = await signedIn.served.call('GET', '/oauth/client.json', { key: signedIn.key });
      const { authorize } = await consentStartedBy(signedIn.served, { org: 'acme', key: signedIn.key });

      expect(withoutKey).toMatchObject({ status: 200, body: documentHolding(returnAddress) });
      expect(withKey.text).toBe(withoutKey.text);
      expect([withoutKey.headers.get('content-type'), withoutKey.headers.get('cache-control')]).toEqual([
        'application/json',
        'public, max-age=300',
      ]);
      expect([authorize.searchParams.get('client_id'), authorize.searchParams.get('redirect_uri')]).toEqual([
        documentAddress,
        returnAddress,
      ]);
    },
  );

  it('refuses another method as the API refuses one, without a key', async () => {
    const fake = await documentingFake('https://studio.on.auto/connect-return');
    const { served } = await signedInAt(runtimeAddress, documentedAt(fake));

    const posted = await served.call('POST', '/oauth/client.json');

    expect([posted.status, posted.headers.get('allow')]).toEqual([405, 'GET, HEAD']);
  });

  it('is not served where PUBLIC_URL is http, nor where it is not set, nor in local mode at an https loopback address', async () => {
    const http = await signedInAt('http://localhost:5555', {});
    const local = await servingReasoning([], {});
    onTestFinished(local.stop);
    const declared = await servingReasoning([], { ACCESS_MODE: 'local', PUBLIC_URL: 'https://localhost:5555' });
    onTestFinished(declared.stop);

    expect([
      await http.served.call('GET', '/oauth/client.json', { key: http.key }),
      await http.served.call('GET', '/oauth/client.json'),
      await local.call('GET', '/oauth/client.json'),
      await declared.call('GET', '/oauth/client.json'),
    ]).toMatchObject([{ status: 404 }, { status: 401 }, { status: 404 }, { status: 404 }]);
  });
});

function audiencesServedBy(api: FakeApiServer): Environment {
  const { issuer } = Option.getOrThrow(Option.fromNullishOr(api.issuing));
  const [way] = audiences.credentials;
  const provider = {
    ...audiences,
    document: api.documentUrl,
    base_url: api.baseUrl,
    credentials: [{ ...way, issuer }],
  };
  return {
    CONNECTIONS: JSON.stringify({
      registered_clients: [{ issuers: [issuer], client_id: 'auto-runtime', client_secret: '${AUDIENCES_SECRET}' }],
      providers: [provider],
    }),
    AUDIENCES_SECRET: consentSecret,
  };
}

async function servedForAudiences(): Promise<{ readonly api: FakeApiServer; readonly served: ReasoningServer }> {
  const { port, returnAddress } = await servedStudioReturn();
  const api = await serveFakeApi({ client: consentRegistration({ redirectUris: [returnAddress] }) });
  onTestFinished(api.close);
  const served = await servingReasoning([], { PORT: String(port), ...sealing, ...audiencesServedBy(api) });
  onTestFinished(served.stop);
  await served.call('POST', '/v1/orgs/local/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return { api, served };
}

describe('a connection connected by consent from a provider that writes {client_id}, over HTTP', () => {
  it('sends the client the connection was made with where the provider writes it, never the placeholder', async () => {
    const { api, served } = await servedForAudiences();
    const id = await connectedByConsent(served, { provider: 'audiences' });

    const searched = await served.call(
      'POST',
      '/v1/orgs/local/playbooks/alpha/tool-servers/audiences/tools/search/execute',
      { body: { arguments: { query: 'acme' } } },
    );
    const read = await served.call('GET', `/v1/orgs/local/connections/${id}`);

    expect(searched.body).toMatchObject({ outcome: 'result' });
    expect(api.seen().map(({ path, headers }) => [path, headers['x-client']])).toEqual([
      ['/v1/search', 'auto-runtime'],
    ]);
    expect(read.body).toMatchObject({
      entry: { headers: { 'X-Client': '{client_id}' } },
      credential: { client_id: 'auto-runtime', client_source: 'registered' },
    });
  });
});
