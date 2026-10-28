import { afterEach, describe, expect, it } from 'vitest';

import { servedForConsent } from '../consent-testing/consent-servers.ts';
import type { FakeMcpServer } from './fake-mcp-answers.ts';
import { serveFakeMcp } from './fake-mcp-server.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function kept(served: Promise<FakeMcpServer>): Promise<FakeMcpServer> {
  const fake = await served;
  closing.push(fake.close);
  return fake;
}

const pingWithoutAToken = {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
};

async function answerToAPingOf({ url }: FakeMcpServer) {
  const answer = await fetch(url, pingWithoutAToken);
  await answer.body?.cancel();
  return { status: answer.status, challenge: answer.headers.get('www-authenticate') };
}

const missingToken = 'Bearer error="invalid_token", error_description="Missing Authorization header"';

describe('the fake MCP server asked without a token', () => {
  it('answers with no challenge where it takes no token, with one that names no metadata where it takes a bearer token alone, and with one that names its metadata where it signs people in', async () => {
    const open = await kept(serveFakeMcp());
    const bearing = await kept(serveFakeMcp({ bearer: 'files-token' }));
    const signing = await kept(servedForConsent({ dynamicRegistration: true }));

    expect([await answerToAPingOf(open), await answerToAPingOf(bearing), await answerToAPingOf(signing)]).toEqual([
      { status: 400, challenge: null },
      { status: 401, challenge: missingToken },
      {
        status: 401,
        challenge: `${missingToken}, resource_metadata="${signing.origin}/.well-known/oauth-protected-resource/mcp"`,
      },
    ]);
  });
});
