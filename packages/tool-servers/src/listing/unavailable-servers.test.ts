import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import { reportingAccess, type AccessOptions } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const alpha = { org: 'acme', playbook: 'alpha' };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function remote(fake: FakeMcpServer, changes: Readonly<Record<string, unknown>> = {}) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...changes };
}

function accessTo(servers: Readonly<Record<string, unknown>>, options: AccessOptions = {}) {
  const { access } = reportingAccess(servers, { ...options, environment: { GRAPH_API_KEY: apiKey } });
  closing.push(access.close);
  return access;
}

function listed(servers: Readonly<Record<string, unknown>>, options: AccessOptions = {}) {
  return Effect.runPromise(accessTo(servers, options).listServers(alpha));
}

const echoTool = {
  name: 'echo',
  description: 'Answers with its arguments.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

describe('a tool server that cannot be asked for its tools', () => {
  it('is unavailable, in words, beside the servers that answer', async () => {
    const fake = await fakeServer();
    const gone = await serveFakeMcp();
    await gone.close();

    const listing = await listed({ graph: remote(gone), wiki: remote(fake, { allowed: ['echo'] }) });

    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'mcp',
        record_content: true,
        provider: null,
        playbooks: ['*'],
        unavailable: 'The tool server graph could not be used: The tool server could not be reached',
        because: 'unreachable',
      },
      { name: 'wiki', type: 'mcp', record_content: true, provider: null, playbooks: ['*'], tools: [echoTool] },
    ]);
  });

  it('is unavailable while it keeps failing', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake) });

    fake.answerNextWith(503);
    const listing = await Effect.runPromise(access.listServers(alpha));

    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'mcp',
        record_content: true,
        provider: null,
        playbooks: ['*'],
        unavailable: 'The tool server graph could not be used: The tool server answered HTTP 503',
        because: 'failing',
      },
    ]);
  });
});

describe('the words of a tool server that cannot be asked', () => {
  it('are cut at 1 KiB, the bound every reader of a failure shares, and not at the bound of a description', async () => {
    const fake = await fakeServer();
    const refusal = 'The gateway refused the request. '.repeat(100);
    const failing = () => Promise.reject(new Error(refusal));

    const listing = await listed({ graph: remote(fake) }, { fetch: failing });

    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'mcp',
        record_content: true,
        provider: null,
        playbooks: ['*'],
        unavailable: `The tool server graph could not be used: ${refusal}`.slice(0, toolBounds.failureBytes),
        because: 'failing',
      },
    ]);
  });
});

describe('a tool server that answers its opening HTTP 403, as a gateway answers one operation it denies', () => {
  it('is unavailable because it is failing, and not because it refused its key', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake) });

    fake.answerNextWith(403);
    const listing = await Effect.runPromise(access.listServers(alpha));

    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'mcp',
        record_content: true,
        provider: null,
        playbooks: ['*'],
        unavailable: 'The tool server graph could not be used: The tool server answered HTTP 403',
        because: 'failing',
      },
    ]);
  });
});
