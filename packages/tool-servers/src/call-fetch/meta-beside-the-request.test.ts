import { CallFetch, type CallMeta, type FetchOfACall } from '@on.auto/operations';
import { Effect, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeConnections } from '../testing/fake-connections.ts';
import { describedAccess, patientTiming } from '../testing/index.ts';
import { serveFakeApi, type FakeApiServer } from '../testing/served-fakes.ts';

const clientSecret = 'graph-client-secret-81c2';

const client = { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 };

const environment = { GRAPH_CLIENT_SECRET: clientSecret };

const ofARequest: CallMeta = {
  'auto.on/run_id': 'run-1',
  'auto.on/delivery_id': 'delivery-1',
  'auto.on/takes_answer': true,
};

const ofANotification: CallMeta = { 'auto.on/run_id': 'run-1', 'auto.on/delivery_id': 'delivery-1' };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Handed {
  readonly path: string;
  readonly beside: readonly unknown[];
}

function lentFetch() {
  const handed: Handed[] = [];
  const fetch: FetchOfACall = (...[input, init, ...beside]: readonly [unknown, unknown?, ...unknown[]]) => {
    handed.push({ path: new URL(String(input)).pathname, beside });
    return globalThis.fetch(String(input), Object.assign({}, init));
  };
  return { fetch, handed: () => [...handed] };
}

function issuerOf(api: FakeApiServer): string {
  return Option.getOrThrow(Option.fromNullishOr(api.issuing)).issuer;
}

async function servedApi(options: Parameters<typeof serveFakeApi>[0] = {}): Promise<FakeApiServer> {
  const api = await serveFakeApi(options);
  closing.push(api.close);
  return api;
}

async function accessTo(billing: FakeApiServer, ledger: FakeApiServer, auth: (api: FakeApiServer) => object) {
  const connections = fakeConnections();
  connections.connect('acme', {
    id: 'ledger-id',
    name: 'ledger',
    entry: { document: ledger.documentUrl, ...auth(ledger) },
    environment,
  });
  const { access } = await describedAccess(
    { billing: { org: 'acme', document: billing.documentUrl, ...auth(billing) } },
    { environment, timing: patientTiming, connections },
  );
  closing.push(access.close);
  return access;
}

const byClientCredentials = (api: FakeApiServer) => ({
  auth: { issuer: issuerOf(api), client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' },
});

const byKey = () => ({ security: { apiKeyAuth: '${GRAPH_CLIENT_SECRET}' } });

function searchedWith(meta: CallMeta, server: string) {
  return { org: 'acme', playbook: 'alpha', reference: { server, tool: 'search' }, input: { query: 'acme' }, meta };
}

describe('the metadata of a call, beside its request', () => {
  it('is handed to the fetch of the call with the request of the call alone, of an entry and of a connection', async () => {
    const [billing, ledger] = [await servedApi({ client }), await servedApi({ client })];
    const access = await accessTo(billing, ledger, byClientCredentials);
    const lent = lentFetch();

    const answered = await Effect.runPromise(
      Effect.all([
        access.callOnce(searchedWith(ofARequest, 'billing')),
        access.callOnce(searchedWith(ofARequest, 'ledger')),
      ]).pipe(Effect.provideService(CallFetch, lent.fetch)),
    );
    const handed = lent.handed();

    expect(answered).toMatchObject([{ outcome: 'result' }, { outcome: 'result' }]);
    expect(handed.filter(({ beside }) => beside.length > 0)).toEqual([
      { path: '/v1/search', beside: [ofARequest] },
      { path: '/v1/search', beside: [ofARequest] },
    ]);
    expect(handed.filter(({ beside }) => beside.length === 0).map(({ path }) => path)).toEqual(
      expect.arrayContaining(['/openapi.json', '/token']),
    );
  });

  it('sends nothing more where no fetch of a call is lent, so an HTTP API sees a request as it sees a notification', async () => {
    const keyed = { key: clientSecret };
    const [billing, ledger] = [await servedApi(keyed), await servedApi(keyed)];
    const access = await accessTo(billing, ledger, byKey);

    await Effect.runPromise(
      Effect.all([
        access.callOnce(searchedWith(ofARequest, 'billing')),
        access.callOnce(searchedWith(ofANotification, 'billing')),
        access.callOnce(searchedWith(ofARequest, 'ledger')),
        access.callOnce(searchedWith(ofANotification, 'ledger')),
      ]),
    );
    const [asked, told] = billing.seen();
    const [askedOfTheConnection, toldOfTheConnection] = ledger.seen();

    expect(asked).toMatchObject({ method: 'GET', path: '/v1/search', query: '?query=acme' });
    expect(told).toEqual(asked);
    expect(toldOfTheConnection).toEqual(askedOfTheConnection);
    expect(JSON.stringify([asked, askedOfTheConnection])).not.toMatch(/auto\.on|takes_answer|delivery|run-1/u);
  });
});
