import { Function, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defaultTiming, secretsOf } from '../index.ts';
import type { McpServerSettings } from '../settings/server-settings.ts';
import { consentClientWith, testClientInfo } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';
import { serverLink } from './server-links.ts';

const clientSecret = 'graph-client-secret-81c2';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function namingAnotherAuthorizationServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({
    client: {
      clientId: 'playbook',
      clientSecret,
      expiresInSeconds: 3600,
      authorizationServers: ['https://browser-sign-in.example.com'],
    },
  });
  closing.push(fake.close);
  return fake;
}

function settingsOf(fake: FakeMcpServer): McpServerSettings {
  return {
    type: 'mcp',
    name: 'graph',
    url: fake.url,
    headers: new Map(),
    auth: {
      issuer: fake.origin,
      client_id: 'playbook',
      scope: null,
      discovery: 'issuer',
      credential: { kind: 'client_secret', client_secret: Redacted.make(clientSecret) },
    },
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

describe('an mcp server whose auth block names discovery issuer', () => {
  it('takes its token from the issuer, whatever authorization server the metadata of the server names', async () => {
    const fake = await namingAnotherAuthorizationServer();
    const link = serverLink(settingsOf(fake), {
      clientInfo: testClientInfo,
      fetch: globalThis.fetch,
      consent: consentClientWith(),
      secrets: secretsOf([]),
      now: Date.now,
      timing: defaultTiming,
      reportOutput: Function.constVoid,
      reportMarkUnlisted: Function.constVoid,
    });
    closing.push(link.stop);

    await expect(link.take()).resolves.toBeDefined();
    expect(fake.tokenRequests()).toBe(1);
  });
});
