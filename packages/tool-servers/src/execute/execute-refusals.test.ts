import { afterEach, describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import { patientTiming, playbookToolCalls, reportingAccess, toolReader, type AccessOptions } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function entryOn(fake: FakeMcpServer, entry: Readonly<Record<string, unknown>> = {}) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
}

function executingOn(fake: FakeMcpServer, entry: Readonly<Record<string, unknown>> = {}, options: AccessOptions = {}) {
  const { access } = reportingAccess(
    { graph: entryOn(fake, entry) },
    { timing: patientTiming, ...options, environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  const { call } = playbookToolCalls(access);
  return (input: unknown, asking = {}) => call('execute', input, asking);
}

describe('a tool this playbook is not offered', () => {
  it('is refused before any client opens when its entry does not allow it or no server of the name serves the playbook', async () => {
    const fake = await fakeServer();
    const narrowed = executingOn(fake, { allowed: ['echo'] });
    const elsewhere = executingOn(fake, { org: 'globex' });
    const otherPlaybooks = executingOn(fake, { playbooks: ['sales'] });

    expect([
      await narrowed({ server: 'graph', tool: 'search', arguments: { query: 'acme' } }),
      await elsewhere({ server: 'graph', tool: 'search' }),
      await otherPlaybooks({ server: 'graph', tool: 'search' }),
      await narrowed({ server: 'mail', tool: 'search' }),
    ]).toMatchObject([
      {
        reason: 'unavailable',
        kind: 'tool_not_offered',
        because: 'tool_not_allowed',
        detail: 'The operator of this server does not allow graph/search',
      },
      { kind: 'tool_not_offered', because: 'tool_server_not_configured' },
      { kind: 'tool_not_offered', because: 'tool_server_not_configured' },
      { because: 'tool_server_not_configured', detail: 'No tool server named mail is configured for this playbook' },
    ]);
    expect(fake.seen()).toEqual([]);
  });

  it('is refused when its server does not list it, and the session is let go', async () => {
    const fake = await fakeServer();

    expect(await executingOn(fake)({ server: 'graph', tool: 'lookup' })).toMatchObject({
      reason: 'unavailable',
      kind: 'tool_not_offered',
      because: 'tool_not_listed',
      detail: 'The tool server graph does not list the tool lookup',
    });
    expect(fake.received()).toEqual([]);
    expect(fake.openSessions()).toBe(0);
  });
});

describe('a tool server that cannot be used', () => {
  it('is refused as unreachable, failing, slowing down or refusing its key, with no call sent', async () => {
    const fake = await fakeServer();
    const gone = await serveFakeMcp();
    await gone.close();
    const execute = executingOn(fake);
    const asked = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

    const unreachable = await executingOn(gone)(asked);
    fake.answerNextWith(503);
    const failing = await execute(asked);
    fake.answerNextWith(429);
    const limited = await execute(asked);
    fake.answerNextWith(401, 2);
    const refused = await execute(asked);

    expect([unreachable, failing, limited, refused]).toMatchObject(
      ['unreachable', 'failing', 'rate_limited', 'key_refused'].map((because) => ({
        reason: 'unavailable',
        kind: 'tool_server_failed',
        because,
      })),
    );
    expect(fake.received()).toEqual([]);
  });

  it('is refused in words cut at 1 KiB, the bound search and a delivery cut the same failure at', async () => {
    const fake = await fakeServer();
    const refusal = 'The gateway refused the request. '.repeat(100);
    const execute = executingOn(fake, {}, { fetch: () => Promise.reject(new Error(refusal)) });

    expect(await execute({ server: 'graph', tool: 'search', arguments: { query: 'acme' } })).toMatchObject({
      reason: 'unavailable',
      kind: 'tool_server_failed',
      because: 'failing',
      detail: `The tool server graph could not be used: ${refusal}`.slice(0, toolBounds.failureBytes),
    });
  });
});

describe('who may execute a tool, and in which playbook', () => {
  it('refuses a caller that may only read, whatever the tool does, and a playbook that is retired, as every command', async () => {
    const fake = await fakeServer();
    const execute = executingOn(fake);

    expect([
      await execute({ server: 'graph', tool: 'search' }, { caller: toolReader }),
      await execute({ server: 'graph', tool: 'search' }, { playbook: 'old' }),
    ]).toMatchObject([{ reason: 'forbidden' }, { reason: 'conflict', kind: 'retired' }]);
    expect(fake.seen()).toEqual([]);
  });
});
