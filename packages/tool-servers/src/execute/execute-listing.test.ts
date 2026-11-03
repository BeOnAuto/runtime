import { afterEach, describe, expect, it } from 'vitest';

import { patientTiming, playbookToolCalls, reportingAccess } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function callsTo(handlesMoney: boolean) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = {
    url: fake.url,
    headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
    org: 'acme',
    ...(handlesMoney ? { handles_money: true } : {}),
  };
  const { access } = reportingAccess({ graph }, { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey } });
  closing.push(access.close);
  return { fake, calls: playbookToolCalls(access) };
}

const searched = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

const echoed = { server: 'graph', tool: 'echo', arguments: { said: 'hello' } };

const notOffered = {
  status: 'rejected',
  reason: 'unavailable',
  kind: 'tool_not_offered',
  detail:
    'The directory listing does not offer the tool server graph, whose tools pay, refund, transfer or pay out money',
};

describe('a server whose tools handle money, called through the directory listing', () => {
  it('is refused by query_connection and execute_connection, and nothing is sent', async () => {
    const { fake, calls } = await callsTo(true);

    expect([
      await calls.call('query_connection', searched, { directoryListing: true }),
      await calls.call('execute_connection', echoed, { directoryListing: true }),
    ]).toMatchObject([notOffered, notOffered]);
    expect(fake.received()).toEqual([]);
  });

  it('is called as any other outside the directory listing', async () => {
    const { fake, calls } = await callsTo(true);

    expect(await calls.call('query_connection', searched)).toMatchObject({ status: 'succeeded' });
    expect(fake.received()).toMatchObject([{ tool: 'search' }]);
  });

  it('is left out of search through the directory listing', async () => {
    const { calls } = await callsTo(true);

    expect([await calls.call('search', {}, { directoryListing: true }), await calls.call('search', {})]).toMatchObject([
      { status: 'succeeded', output: { servers: [] } },
      { status: 'succeeded', output: { servers: [{ name: 'graph' }] } },
    ]);
  });
});

describe('a server whose tools handle no money, called through the directory listing', () => {
  it('is called as any other', async () => {
    const { fake, calls } = await callsTo(false);

    expect(await calls.call('query_connection', searched, { directoryListing: true })).toMatchObject({
      status: 'succeeded',
    });
    expect(fake.received()).toMatchObject([{ tool: 'search' }]);
  });
});
