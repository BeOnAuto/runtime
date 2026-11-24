import { AuthorizationServerMismatchError } from '@modelcontextprotocol/client';
import type { FetchOfACall } from '@on.auto/operations';
import { Function } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { SubjectTokensAbsent, defaultTiming, jwtTokenType, secretsOf } from '../index.ts';
import type { AuthSettings, McpServerSettings } from '../settings/server-settings.ts';
import { consentClientWith, fakeMcpInProcess, inProcessFetch, testClientInfo } from '../testing/index.ts';
import type { FakeMcpServer } from '../testing/served-fakes.ts';
import { askingFetch, clientSecret, secretAuth } from '../testing/token-sources.ts';
import { openerOf, tokensOfTheLink } from './link-openers.ts';

const audience = 'https://graph.example.com/api';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function served(authorizationServers?: readonly string[]): FakeMcpServer {
  const fake = fakeMcpInProcess({
    client: {
      clientId: 'playbook',
      clientSecret,
      expiresInSeconds: 3600,
      ...(authorizationServers === undefined ? {} : { authorizationServers }),
    },
  });
  closing.push(fake.close);
  return fake;
}

function settingsOf(fake: Pick<FakeMcpServer, 'url'>, auth: AuthSettings): McpServerSettings {
  return {
    type: 'mcp',
    name: 'graph',
    url: fake.url,
    headers: new Map(),
    auth,
    orgs: ['acme'],
    playbooks: null,
    allowed: null,
    marks: { reads: [], acts: [] },
    record_content: false,
    request_id: null,
    secrets: [],
    connection: null,
    provider: null,
  };
}

async function opened(settings: McpServerSettings, fetch: FetchOfACall = inProcessFetch): Promise<void> {
  const client = await openerOf(settings, {
    clientInfo: testClientInfo,
    fetch,
    consent: consentClientWith(),
    secrets: secretsOf([]),
    now: Date.now,
    timing: defaultTiming,
    reportOutput: Function.constVoid,
    reportMarkUnlisted: Function.constVoid,
  })();
  closing.push(client.end);
}

describe('the opener of an mcp server whose metadata names another authorization server', () => {
  it('takes its token from the issuer, for the audience, where the auth block names discovery issuer', async () => {
    const named = served();
    const fake = served([named.origin]);
    const asking = askingFetch();

    await opened(settingsOf(fake, secretAuth(fake, { discovery: 'issuer', audience })), asking.fetch);

    expect([fake.tokenRequests(), named.tokenRequests()]).toEqual([1, 0]);
    expect(asking.bodies()).toMatchObject([{ audience }]);
  });

  it('asks for no token where the auth block names no discovery, or protected_resource', async () => {
    const named = served();
    const fake = served([named.origin]);

    const leftOut = settingsOf(fake, secretAuth(fake));
    const written = settingsOf(fake, secretAuth(fake, { discovery: 'protected_resource' }));

    await expect(opened(leftOut)).rejects.toBeInstanceOf(AuthorizationServerMismatchError);
    await expect(opened(written)).rejects.toBeInstanceOf(AuthorizationServerMismatchError);
    expect([fake.tokenRequests(), named.tokenRequests()]).toEqual([0, 0]);
  });
});

const exchanging: AuthSettings = {
  grant: 'token_exchange',
  scope: 'service.read',
  token_endpoint: 'https://sts.service.example.com/v1/token',
  audience: '//identity.service.example.com/pools/auto',
  subject_token: { type: jwtTokenType, audience: 'https://identity.service.example.com/pools/auto' },
  credential: { kind: 'subject_token' },
};

function tokensFor(orgs: readonly string[] | null) {
  const asked: string[] = [];
  const settings: McpServerSettings = {
    ...settingsOf({ url: 'https://mcp.service.example.com/mcp' }, exchanging),
    orgs,
  };
  const tokens = tokensOfTheLink(settings, {
    clientInfo: testClientInfo,
    fetch: () => Promise.resolve(new Response(JSON.stringify({ access_token: 'exchanged-1', expires_in: 3600 }))),
    consent: consentClientWith(),
    subjectTokens: {
      signedFor: ({ org }) => {
        asked.push(org);
        return Promise.resolve(`signed-for-${org}`);
      },
    },
    secrets: secretsOf([]),
    now: Date.now,
    timing: defaultTiming,
    reportOutput: Function.constVoid,
    reportMarkUnlisted: Function.constVoid,
  });
  return { token: () => tokens?.token() ?? Promise.reject(new Error('no token source')), asked };
}

describe('the tokens of a connection whose auth block exchanges a token the server signs', () => {
  it('asks the server for a subject token of the one organization the connection serves', async () => {
    const { token, asked } = tokensFor(['org_acme']);

    await expect(token()).resolves.toBe('exchanged-1');
    expect(asked).toEqual(['org_acme']);
  });

  it.each([[null], [['org_acme', 'org_globex']]] as const)(
    'asks for no subject token where the server serves %o',
    async (orgs) => {
      const { token, asked } = tokensFor(orgs);

      await expect(token()).rejects.toBeInstanceOf(SubjectTokensAbsent);
      expect(asked).toEqual([]);
    },
  );
});
