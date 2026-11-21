import { afterEach, describe, expect, it } from 'vitest';

import { accessTo, apiKey, called, clientSecret, keyed } from '../api-testing/api-calls.ts';
import { handedOverAt } from '../consent-testing/gateway-asking.ts';
import {
  connectedThroughAuto,
  fakeApiInProcess,
  fakeGatewayInProcess,
  fakeMcpInProcess,
  throughAutoInProcess,
  type AccessOptions,
  type FakeApiOptions,
  type ThroughAuto,
} from './index.ts';
import { calledOnce, echoCall, oneCallAccess, oneCallKey } from './one-calls.ts';
import { serveFakeApi, serveFakeGateway, serveFakeMcp, servedThroughAuto } from './served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function kept<Served extends { readonly close: () => Promise<void> }>(served: Served): Served {
  closing.push(served.close);
  return served;
}

const inProcessAccess: Pick<AccessOptions, 'fetch'> = {};

const platformAccess: Pick<AccessOptions, 'fetch'> = { fetch: null };

const keyedApi: FakeApiOptions = { key: apiKey };

const forms = [
  {
    form: 'in process',
    accessing: inProcessAccess,
    mcp: () => Promise.resolve(fakeMcpInProcess({ bearer: oneCallKey })),
    api: (options: FakeApiOptions = keyedApi) => Promise.resolve(fakeApiInProcess(options)),
    consents: (): Promise<ThroughAuto> => Promise.resolve(throughAutoInProcess()),
    gateway: () => Promise.resolve(fakeGatewayInProcess()),
  },
  {
    form: 'over a loopback socket, through the platform’s own fetch',
    accessing: platformAccess,
    mcp: () => serveFakeMcp({ bearer: oneCallKey }),
    api: (options: FakeApiOptions = keyedApi) => serveFakeApi(options),
    consents: () => servedThroughAuto(),
    gateway: () => serveFakeGateway(),
  },
] as const;

describe.each(forms)('the fakes served $form, as the runtime reaches them', ({ accessing, mcp, api }) => {
  it('an MCP server lists its tools to the runtime and answers a call of one with what it was sent', async () => {
    const fake = kept(await mcp());

    expect(await calledOnce(oneCallAccess(fake.url, {}, {}, accessing.fetch))).toMatchObject({
      outcome: 'result',
      answer: { content: [{ type: 'text', text: JSON.stringify(echoCall.input) }] },
    });
    expect(fake.seen().map(({ rpc }) => rpc)).toEqual(
      expect.arrayContaining(['initialize', 'tools/list', 'tools/call']),
    );
    expect(fake.received()).toMatchObject([{ tool: 'echo', arguments: echoCall.input }]);
  });

  it('an MCP server refuses a request without its token, and the runtime calls no tool', async () => {
    const fake = kept(await mcp());

    expect(await calledOnce(oneCallAccess(fake.url, { headers: {} }, {}, accessing.fetch))).not.toMatchObject({
      outcome: 'result',
    });
    expect(fake.received()).toEqual([]);
  });

  it('an HTTP API of client credentials answers a call made with a token its own issuer gave', async () => {
    const fake = kept(await api({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } }));
    const issuer = String(fake.issuing?.issuer);
    const auth = { issuer, client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' };

    expect(
      await called(await accessTo({ document: fake.documentUrl, auth }, accessing), 'rows', { tag: ['open'] }),
    ).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(fake.issuing?.tokenRequests()).toBe(1);
  });

  it('an HTTP API answers the document the runtime reads and the operation it calls', async () => {
    const fake = kept(await api());

    const answered = await called(await accessTo(keyed(fake), accessing), 'rows', {
      tag: ['open'],
    });

    expect(answered).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(fake.documentReads()).toBe(1);
    expect(fake.seen()).toMatchObject([{ method: 'GET' }]);
  });
});

describe.each(forms)(
  'the fakes of Auto’s own services served $form, as the runtime reaches them',
  ({ consents, gateway }) => {
    it('a consent service hands a person’s consent with its vendor to the runtime as tokens', async () => {
      const served = kept(await consents());

      await connectedThroughAuto(served);

      expect(served.service.calls().map(({ path }) => path)).toEqual(
        expect.arrayContaining([expect.stringContaining('redeem')]),
      );
      expect(served.fake.tokenRequests()).toBeGreaterThan(0);
    });

    it('a gateway hands over one connection key once a person allows it', async () => {
      const fake = kept(await gateway());

      await handedOverAt(fake);

      expect(fake.keys()).toHaveLength(1);
    });
  },
);
