import { AuthorizationServerMismatchError } from '@modelcontextprotocol/client';
import type { FetchOfACall } from '@on.auto/operations';
import { Function } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defaultTiming, secretsOf } from '../index.ts';
import type { AuthSettings, McpServerSettings } from '../settings/server-settings.ts';
import { consentClientWith, fakeMcpInProcess, inProcessFetch, testClientInfo } from '../testing/index.ts';
import type { FakeMcpServer } from '../testing/served-fakes.ts';
import { askingFetch, clientSecret, secretAuth } from '../testing/token-sources.ts';
import { openerOf } from './link-openers.ts';

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

function settingsOf(fake: FakeMcpServer, auth: AuthSettings): McpServerSettings {
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
