import { appLevelToken, ledgers, overASocket, providersOf, tracker } from '@on.auto/providers/testing';
import { Result, Schema, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { hostsReachedBy } from '../policy/policy-rules.ts';
import { added, billing, crm, lastFact, reconnected } from '../testing/additions.ts';
import { fakeReads, fakeSockets, type ReadAnswer } from '../testing/harness-services.ts';
import { ada, harness, operationNamed, recordedAs, type Harness, type HarnessOptions } from '../testing/harness.ts';
import { appCredentialsGivenOf } from './given-apps.ts';

const anyWords: unknown = expect.any(String);

function naming(host: string): unknown {
  return expect.stringContaining(host);
}

const [trackersKey, ...trackersOtherWays] = tracker.credentials;

const tested = providersOf({
  ...tracker,
  credentials: [{ ...trackersKey, test: { tool: 'viewer' }, app_credentials: [appLevelToken] }, ...trackersOtherWays],
  events: { destinations: [overASocket] },
});

const fromTheTracker = { provider: 'tracker', placeholders: { site: 'acme' } };

const trackerKey = 'trk_0f3cAcme';

const appToken = 'xapp-1-A0001-0f3c';

function giving(h: Harness, input: Readonly<Record<string, unknown>>) {
  return h.call(operationNamed(h.operations, 'give_credential'), ada, input);
}

async function givenOnce(options: HarnessOptions, appCredentials?: Readonly<Record<string, string>>) {
  const h = harness({ providers: tested, ...options });
  const { id, token } = await added(h, fromTheTracker);
  const given = await giving(h, {
    id,
    token,
    value: trackerKey,
    ...(appCredentials === undefined ? {} : { app_credentials: appCredentials }),
  });
  return { h, id, token, given };
}

const unreached: ReadAnswer = {
  kind: 'unopened',
  refused: 'tool_server_failed',
  because: 'unreachable',
  detail: 'The tool server tracker could not be used',
};

const failing: ReadAnswer = {
  kind: 'answered',
  outcome: 'server_failure',
  failed: { because: 'server_failure', duration_ms: 3, jsonrpc_id: null },
  because: 'failing',
  detail: 'The tool server tracker answered HTTP 500',
  retryAfterMs: null,
  mark: 'reads',
};

const toolError: ReadAnswer = {
  kind: 'answered',
  outcome: 'tool_error',
  answered: { is_error: true, result_bytes: 2, duration_ms: 3, jsonrpc_id: 1 },
  detail: '',
  retryAfterMs: null,
  mark: 'reads',
};

async function triedWith(answer: ReadAnswer) {
  const { h, id, token, given } = await givenOnce({ readOnceThrough: fakeReads(answer).readOnceThrough });
  const again = await giving(h, { id, token, value: trackerKey });
  return [given, h.secrets.values().size, again.status, JSON.stringify(h.logged()).includes(trackerKey)];
}

describe('the key of a provider whose way names a test', () => {
  it('is tested once, through the tool it names, with the value given, before anything is kept', async () => {
    const reads = fakeReads();
    const { id, given } = await givenOnce({ readOnceThrough: reads.readOnceThrough });

    expect(given).toMatchObject({ status: 'succeeded' });
    expect(reads.read().map(([call, through]) => [call, through.connection, through.server.settings.type])).toEqual([
      [{ org: 'acme', reference: { server: 'tracker', tool: 'viewer' }, meta: {} }, id, 'mcp'],
    ]);
  });

  it('refused by the service, keeps nothing, leaves the link open and answers at the key', async () => {
    expect(await triedWith('refused')).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: anyWords,
        issues: [{ pointer: '/value', detail: anyWords }],
      },
      0,
      'rejected',
      false,
    ]);
  });

  it('not checked, where its server cannot be reached or answers anything else, keeps nothing and names its host', async () => {
    const outcomes = await Promise.all([unreached, failing, toolError].map((answer) => triedWith(answer)));

    expect(outcomes).toEqual([
      [{ status: 'rejected', reason: 'unavailable', detail: anyWords }, 0, 'rejected', false],
      [{ status: 'rejected', reason: 'unavailable', detail: anyWords }, 0, 'rejected', false],
      [{ status: 'rejected', reason: 'unavailable', detail: anyWords }, 0, 'rejected', false],
    ]);
    expect(outcomes[0]?.[0]).toMatchObject({ detail: naming('acme.tracker.example.com') });
  });

  it('is not tested for a connection given by hand, whose way names none', async () => {
    const reads = fakeReads('refused');
    const h = harness({ readOnceThrough: reads.readOnceThrough });
    const { id, token } = await added(h, crm);

    expect(await giving(h, { id, token, value: 'Bearer crm-0f3c' })).toMatchObject({ status: 'succeeded' });
    expect(reads.read()).toEqual([]);
  });
});

describe('the app credentials a person gives beside the key', () => {
  it('are refused where this runtime opens no socket, and for a connection given by hand, keeping nothing', async () => {
    const h = harness({ providers: tested });
    const fromTheProvider = await added(h, fromTheTracker);
    const byHand = await added(h, crm);
    const withAnApp = { app_credentials: { app_level_token: appToken } };

    expect([
      await giving(h, { id: fromTheProvider.id, token: fromTheProvider.token, value: trackerKey, ...withAnApp }),
      await giving(h, { id: byHand.id, token: byHand.token, value: 'Bearer crm-0f3c', ...withAnApp }),
    ]).toMatchObject([
      { reason: 'invalid_input', issues: [{ pointer: '/app_credentials/app_level_token' }] },
      { reason: 'invalid_input', issues: [{ pointer: '/app_credentials/app_level_token' }] },
    ]);
    expect(h.secrets.values().size).toBe(0);
  });

  it('are each opened once where this runtime opens sockets, kept sealed, and recorded by id beside the key', async () => {
    const sockets = fakeSockets({});
    const { h, id, given } = await givenOnce({ sockets }, { app_level_token: appToken });

    expect(given).toMatchObject({
      status: 'succeeded',
      output: { app_credentials: [{ name: 'app_level_token', refused: null }] },
    });
    expect(sockets.opened()).toEqual([['app_level_token', appToken]]);
    expect([...h.secrets.values().values()]).toEqual([trackerKey, appToken]);
    expect(await lastFact(h)).toEqual({
      connection: id,
      secret_id: 'secret-1',
      app_secret_ids: { app_level_token: 'secret-2' },
      connected_by: recordedAs.ada,
    });
    expect(JSON.stringify(await h.facts())).not.toContain(appToken);
  });
});

const checkedSockets = fakeSockets({
  'xapp-refused': { kind: 'refused' },
  'xapp-far': { kind: 'unreached', hosts: ['wss.chat.example.com'] },
});

describe('an app credential the person gives', () => {
  it('is refused under its own name where the service refuses it, it misses its format, or it is not taken here', async () => {
    const answers = await Promise.all(
      [
        { app_level_token: 'xapp-refused' },
        { app_level_token: 'not-an-app-token' },
        { signing_secret: 'whsec_0f3c' },
        { app_level_token: 'xapp-far' },
      ].map(async (appCredentials: Readonly<Record<string, string>>) => {
        const { h, given } = await givenOnce({ sockets: checkedSockets }, appCredentials);
        return [given, h.secrets.values().size];
      }),
    );

    expect(answers).toMatchObject([
      [{ reason: 'invalid_input', issues: [{ pointer: '/app_credentials/app_level_token' }] }, 0],
      [{ reason: 'invalid_input', issues: [{ pointer: '/app_credentials/app_level_token' }] }, 0],
      [{ reason: 'invalid_input', issues: [{ pointer: '/app_credentials/signing_secret' }] }, 0],
      [{ reason: 'unavailable', detail: naming('wss.chat.example.com') }, 0],
    ]);
  });

  it('that the secret store does not take leaves nothing kept, the key it kept just before forgotten', async () => {
    const { h, given } = await givenOnce({ sockets: fakeSockets({}) }, { app_level_token: `xapp-${'a'.repeat(80)}` });

    expect([given, h.secrets.values().size]).toMatchObject([
      { reason: 'invalid_input', issues: [{ pointer: '/app_credentials/app_level_token' }] },
      0,
    ]);
  });

  it('is forgotten with the key when the connection is given again or removed', async () => {
    const { h, id } = await givenOnce({ sockets: fakeSockets({}) }, { app_level_token: appToken });
    const again = await reconnected(h, id);
    await giving(h, { id, token: again.token, value: 'trk_1a2bAcme' });
    const keptAfterGivingAgain = [...h.secrets.values().values()];
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect([keptAfterGivingAgain, h.secrets.values().size]).toEqual([['trk_1a2bAcme'], 0]);
  });
});

const WaysSchema = Schema.Struct({
  output: Schema.Struct({
    providers: Schema.Array(Schema.Struct({ credentials: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) })),
  }),
});

const [heardKey, ...heardOtherWays] = tracker.credentials;

const unheard = providersOf({
  ...tracker,
  credentials: [{ ...heardKey, app_credentials: [appLevelToken] }, ...heardOtherWays],
});

async function firstWayListedWith(options: HarnessOptions) {
  const h = harness({ providers: tested, ...options });
  const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada, {});
  return Schema.decodeUnknownSync(WaysSchema)(listed).output.providers.flatMap(({ credentials }) => credentials)[0];
}

describe('the app credentials a way lists', () => {
  it('are listed where this runtime opens sockets and a socket of the entry names them, never the test of the key', async () => {
    const sockets = fakeSockets({});
    const ways = [
      await firstWayListedWith({ sockets }),
      await firstWayListedWith({}),
      await firstWayListedWith({ sockets, providers: unheard }),
    ];

    expect(ways.map((way) => way?.['app_credentials'])).toEqual([[appLevelToken], undefined, undefined]);
    expect(ways.map((way) => way?.['test'])).toEqual([undefined, undefined, undefined]);
  });

  it('are listed with the heading of their step where the entry gives one', async () => {
    const titledToken = { ...appLevelToken, title: 'Get replies at once' };
    const titled = providersOf({
      ...tracker,
      credentials: [{ ...trackersKey, app_credentials: [titledToken] }, ...trackersOtherWays],
      events: { destinations: [overASocket] },
    });
    const way = await firstWayListedWith({ sockets: fakeSockets({}), providers: titled });

    expect(way?.['app_credentials']).toEqual([titledToken]);
  });
});

describe('the hosts a connection reaches', () => {
  it('are each named once, in the order they are first reached, where an HTTP API reaches one by two addresses', () => {
    const entry = {
      document: 'https://api.billing.example.com/openapi.json',
      base_url: 'https://api.billing.example.com/v2',
    };

    expect(hostsReachedBy({ ...billing, provider: null, entry }, { documentServer: undefined })).toEqual([
      'api.billing.example.com',
      'auth.billing.example.com',
    ]);
  });
});

const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth'] };

const namingItsFailures = providersOf({
  ...Struct.omit(ledgers, ['headers', 'placeholders']),
  base_url: 'https://api.ledgers.example.com/v2',
  credentials: [{ ...trackersKey, app_credentials: [appLevelToken] }],
  events: { destinations: [overASocket] },
  failure_codes: failureCodes,
});

describe('an app credential of an entry that names its failures in a successful answer', () => {
  it("is opened with the entry's failure codes, so the service's refusal of it is read as one", () => {
    const connection = { provider: 'ledgers', credential: { kind: 'secret' } } as const;
    const services = { providers: namingItsFailures, sockets: fakeSockets({}) };
    const plain = { providers: tested, sockets: fakeSockets({}) };

    expect([
      Result.map(appCredentialsGivenOf(connection, { app_level_token: appToken }, services), (given) =>
        given.map(({ failureCodes: codes }) => codes),
      ),
      Result.map(
        appCredentialsGivenOf({ ...connection, provider: 'tracker' }, { app_level_token: appToken }, plain),
        (given) => given.map(({ failureCodes: codes }) => codes),
      ),
    ]).toEqual([Result.succeed([failureCodes]), Result.succeed([undefined])]);
  });
});
