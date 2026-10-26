import { Client, ClientCredentialsProvider, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { issuerOnLoopback, signedInOnLoopback, type OnLoopback } from '../testing/signed-in.ts';
import { toolNamesIn } from '../testing/tool-listing.ts';

const clients = {
  'ada-agent': { secret: 'a-secret-only-ada-holds', claims: { sub: 'ada', name: 'Ada Lovelace', org_id: 'acme' } },
};

const opened: OnLoopback<unknown>[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map(({ close }) => close()));
});

describe('an agent signing in through the authorization server the metadata names', () => {
  it('connects with the SDK’s client, is challenged, gets a token of every scope asked for the resource, is told it acts as the person and calls the tools', async () => {
    const issuer = await issuerOnLoopback(clients);
    const runtime = await signedInOnLoopback(issuer.served);
    opened.push(issuer, runtime);
    const client = new Client({ name: 'auto-runtime-tests', version: '2.0.0' });
    const authProvider = new ClientCredentialsProvider({
      clientId: 'ada-agent',
      clientSecret: 'a-secret-only-ada-holds',
      expectedIssuer: issuer.origin,
    });

    await client.connect(new StreamableHTTPClientTransport(new URL(`${runtime.origin}/mcp`), { authProvider }));
    const instructions = client.getInstructions();
    const tools = await client.listTools();
    await client.callTool({ name: 'add_note', arguments: { playbook: 'alpha', name: 'from-ada', text: 'signed in' } });
    const notes = await client.callTool({ name: 'list_notes', arguments: { playbook: 'alpha' } });
    await client.close();

    const [, claims] = String(authProvider.tokens()?.access_token).split('.');

    expect(instructions).toMatch(/^This connection acts as Ada Lovelace \(person:ada\) in the org acme\. /u);
    expect(toolNamesIn(tools)).toContain('add_note');
    expect(notes.structuredContent).toEqual({ notes: [{ name: 'from-ada', text: 'signed in' }] });
    expect(JSON.parse(Buffer.from(String(claims), 'base64url').toString('utf8'))).toMatchObject({
      iss: issuer.origin,
      aud: runtime.origin,
      sub: 'ada',
      scope: 'user:org:read org:read org:write playbook:read playbook:write',
    });
  });
});
