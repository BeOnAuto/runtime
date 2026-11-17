import { providerListOf } from '@on.auto/providers/testing';
import { custodianRefusal, memoryRows, type RecordingCustodian } from '@on.auto/secrets/testing';
import type {
  AuthSettings,
  ConnectionServer,
  ConnectionServerSettings,
  ConnectionSource,
  ConnectionUnready,
  ConsentCredential,
  OrgConnection,
} from '@on.auto/tool-servers';
import { fakeApiKey, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import {
  clockAt,
  describedAccess,
  type FakeMcpServer,
  manualTimer,
  patientTiming,
  playbookToolCalls,
} from '@on.auto/tool-servers/testing';
import { DateTime, Effect, Fiber, Function, Logger, Option, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crmKeyHelp } from '../testing/additions.ts';
import {
  audiencesAt,
  consentedOf,
  consentFake,
  consentHarnessAt,
  filesAt,
  filesWay,
  finishing,
  studioReturn,
} from '../testing/consents.ts';
import { harness, type Harness, harnessPages, loopbackPolicy } from '../testing/harness.ts';
import { connectedFiles, replacingFiles, replacingPolicy } from '../testing/replacements.ts';
import { givenThrough, sealedIn, sourceLoggingInto } from '../testing/sealed-connections.ts';
import { consentServedAs, servedAs, sourceOver } from '../testing/served-connections.ts';
import { makeConnectionSource } from './connection-source.ts';

const closing: (() => Promise<void>)[] = [];

const consentEnded =
  'The consent of the connection files was revoked or has ended, so the person who added it reconnects it';

const clientGone =
  'The client the connection files was made with is no longer registered, so the person who added it reconnects it';

const keyUnknown =
  "Auto's consent service does not know the key of the connection files, so its tokens cannot be renewed, and the person who added it reconnects it";

const notTokens =
  'The credential of the connection files is not the tokens of a consent the runtime keeps, so the person who added it reconnects it';

const gone =
  'The credential of the connection files is no longer in the secret store, so the person who added it reconnects it';

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake();
  closing.push(fake.close);
  return fake;
}

async function connectedByConsent(way?: Readonly<Record<string, unknown>>) {
  const fake = await served();
  const h = consentHarnessAt(fake, way === undefined ? {} : { way });
  const link = await added(h, { provider: 'files' });
  await finishing(h, link, await consentedOf(h, link));
  return { fake, h, id: link.id };
}

function sourceOf(h: Harness) {
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: loopbackPolicy,
    pages: harnessPages,
    variables: new Map(),
    modelProviders: [],
    providers: providerListOf(),
    providerValues: new Map(),
  });
}

function preparedOf(connection: OrgConnection | undefined): Effect.Effect<ConnectionServer, ConnectionUnready> {
  return connection?.state.status === 'connected'
    ? connection.state.server
    : Effect.die(new Error('Expected a connected connection'));
}

async function preparedIn(h: Harness): Promise<Effect.Effect<ConnectionServer, ConnectionUnready>> {
  const [listed] = await Effect.runPromise(sourceOf(h).connectionsOf('acme'));
  return preparedOf(listed);
}

async function consentOf(h: Harness): Promise<ConsentCredential> {
  const { settings } = await Effect.runPromise(await preparedIn(h));
  const credential = settings.auth?.credential;
  return Option.getOrThrow(Option.liftPredicate(credential, isConsent));
}

function isConsent(credential: AuthSettings['credential'] | undefined): credential is ConsentCredential {
  return credential?.kind === 'consent';
}

function onlyRowOf(h: Harness): readonly [string, string] {
  return Option.getOrThrow(Option.fromNullishOr([...h.secrets.values()].at(0)));
}

function headersOf(settings: ConnectionServerSettings): Readonly<Record<string, string>> {
  return 'headers' in settings
    ? Object.fromEntries(
        [...settings.headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [
          name,
          Redacted.value(value),
        ]),
      )
    : {};
}

function replacedWords(name: string): string {
  return `The connection ${name} was added from the provider files, which messages replaces here, so no playbook may use it until it is reconnected, which adds it again from messages under the same name`;
}

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

async function fakeServerAt(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function graphAt({ url }: FakeMcpServer) {
  return {
    name: 'graph',
    type: 'mcp',
    entry: { url },
    credential: { kind: 'secret', name: 'Authorization', in: 'header', scheme: 'Bearer', ...crmKeyHelp },
  };
}

function loggedLines() {
  const lines: string[] = [];
  const logging = Logger.layer([
    Logger.map(Logger.formatJson, (line: string) => {
      lines.push(line);
    }),
  ]);
  return { lines, logging };
}

async function connectionOf(source: ConnectionSource, id: string): Promise<OrgConnection> {
  return Option.getOrThrow(
    Option.fromNullishOr((await Effect.runPromise(source.connectionsOf('acme'))).find((each) => each.id === id)),
  );
}

function servedOf({ state }: OrgConnection): Effect.Effect<unknown, ConnectionUnready> {
  return state.status === 'connected' ? state.server : Effect.fail(state.unready);
}

async function refusalOf(source: ConnectionSource, id: string): Promise<ConnectionUnready> {
  return Effect.runPromise(Effect.flip(servedOf(await connectionOf(source, id))));
}

const searched = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

const unreadableNow =
  'The credential of the connection graph cannot be read now. It stays connected: ask again later, and if it still cannot be read, whoever runs the runtime finds the cause in its log';

function loggedCause(detail: string): string {
  return `The credential of the connection graph cannot be read now: ${detail}`;
}

function refusedBy(custodian: RecordingCustodian): string {
  return loggedCause(`The custodian of the key ${custodian.kid} refused to unwrap a data key: ${custodianRefusal}`);
}

const refusedCall = {
  status: 'rejected',
  reason: 'unavailable',
  kind: 'tool_not_offered',
  because: 'connection_unavailable',
  detail: unreadableNow,
};

function warningsIn(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.includes('"level":"WARN"'));
}

async function wrappedAgainBadly(rows: ReturnType<typeof memoryRows>, kid: string): Promise<void> {
  const [read] = await Effect.runPromise(rows.heldBy({ keptBy: 'ledger', kid }, 1));
  const held = Option.getOrThrow(Option.fromNullishOr(read));
  await Effect.runPromise(rows.reheld(held, { ...held.holding, wrappedKey: 'not a wrapping' }));
}

describe('consent serving', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a connection connected by consent', () => {
    it('is served with the tokens its row holds, its way, its server and the client it recorded', async () => {
      const { fake, h } = await connectedByConsent();
      const [, value] = onlyRowOf(h);

      const { settings } = await Effect.runPromise(await preparedIn(h));
      const consent = await consentOf(h);

      expect(settings).toMatchObject({
        name: 'files',
        type: 'mcp',
        url: fake.url,
        secrets: [],
        auth: { issuer: fake.origin, client_id: 'auto-runtime', scope: 'files.read' },
      });
      expect(consent).toMatchObject({
        kind: 'consent',
        server: { type: 'mcp', url: fake.url },
        way: { issuer: fake.origin, scope: 'files.read', parameters: { access_type: 'offline' } },
        returnAddress: studioReturn,
        client: { client_id: 'auto-runtime', client_source: 'registered' },
        held: { version: 1, claimedUntil: undefined },
      });
      expect(JSON.stringify(consent.held.tokens)).toBe(value);
    });

    it('is served with no scope where its consent was given none', async () => {
      const { h } = await connectedByConsent({});

      const { settings } = await Effect.runPromise(await preparedIn(h));

      expect(settings.auth?.scope).toBeNull();
    });
  });

  describe('a connection connected by consent whose server refuses its tokens', () => {
    it('is broken in the words of a refused credential, which say to reconnect it', async () => {
      const { h, id } = await connectedByConsent();
      const server = await Effect.runPromise(await preparedIn(h));

      const refused = await Effect.runPromise(server.refused('The tool server answered HTTP 401'));

      expect(refused).toBe(
        'The tool server answered HTTP 401: it refused the credential the connection holds, so the person who added it reconnects it',
      );
      expect((await h.facts()).at(-1)).toMatchObject({
        type: 'connection_broken',
        data: { connection: id, reason: refused },
      });
    });
  });

  describe('a connection connected by consent whose row cannot be served', () => {
    it('is broken at first use in the words of a credential unreadable where its row holds no tokens', async () => {
      const { h } = await connectedByConsent();
      const [secretId] = onlyRowOf(h);
      await Effect.runPromise(h.secrets.replace(secretId, 1, Redacted.make('not the tokens of a consent')));

      const refused = await Effect.runPromise(Effect.flip(await preparedIn(h)));
      const breaks = (await h.facts()).filter(({ type }) => type === 'connection_broken');

      expect(refused).toEqual({ because: 'connection_broken', detail: notTokens });
      expect(breaks).toMatchObject([{ data: { reason: notTokens } }]);
    });

    it('is broken at first use in the words of a credential gone where its row is gone', async () => {
      const { h } = await connectedByConsent();
      const [secretId] = onlyRowOf(h);
      await Effect.runPromise(h.secrets.forget(secretId));

      const refused = await Effect.runPromise(Effect.flip(await preparedIn(h)));

      expect(refused).toEqual({ because: 'connection_broken', detail: gone });
    });
  });

  describe('a connection connected by consent from a provider that writes {client_id}', () => {
    it('records {client_id} as the provider writes it, and is served with the client it was made with in its place', async () => {
      const fake = await served();
      const h = consentHarnessAt(fake, { providers: providerListOf(audiencesAt(fake)) });
      const link = await added(h, { provider: 'audiences' });

      const finished = await finishing(h, link, await consentedOf(h, link));
      const headers = headersOf((await Effect.runPromise(await preparedIn(h))).settings);

      expect(finished).toMatchObject({
        status: 'succeeded',
        output: {
          entry: { headers: { 'X-Client': '{client_id}' } },
          credential: { kind: 'authorization', client_id: 'auto-runtime', client_source: 'registered' },
          status: 'connected',
        },
      });
      expect(headers).toEqual({ 'X-Client': 'auto-runtime' });
    });

    it('holds neither the stand-in the addition read it with nor the placeholder, in its facts or its header', async () => {
      const fake = await served();
      const h = consentHarnessAt(fake, { providers: providerListOf(audiencesAt(fake)) });
      const link = await added(h, { provider: 'audiences' });
      await finishing(h, link, await consentedOf(h, link));

      const headers = headersOf((await Effect.runPromise(await preparedIn(h))).settings);
      const kept = JSON.stringify(await h.facts());

      expect(kept).not.toContain('a client id the person gives');
      expect(Object.values(headers)).not.toContain('{client_id}');
      expect(Object.values(headers)).not.toContain('a client id the person gives');
    });
  });

  describe('the store of the tokens of a connection connected by consent', () => {
    it('claims its row once until the claim ends, and replaces its value under the version read', async () => {
      const { h } = await connectedByConsent();
      const { tokens } = await consentOf(h);
      const renewed = { access_token: 'renewed', token_type: 'Bearer' };

      const claims = [
        await Effect.runPromise(tokens.claim(1, 30_000)),
        await Effect.runPromise(tokens.claim(1, 30_000)),
      ];
      const whileClaimed = await Effect.runPromise(tokens.read);
      const replaced = await Effect.runPromise(tokens.replace(1, Redacted.make(JSON.stringify(renewed))));
      const moved = await Effect.runPromise(tokens.replace(1, Redacted.make(JSON.stringify(renewed))));
      const read = await Effect.runPromise(tokens.read);

      const refused = await Effect.runPromise(Effect.flip(tokens.replace(2, Redacted.make('x'.repeat(4097)))));

      expect(claims).toEqual([{ claimed: true, until: whileClaimed.claimedUntil }, { claimed: false }]);
      expect(refused).toMatchObject({
        _tag: 'secret_refused',
        detail: 'A secret to keep holds more than 4096 characters',
      });
      expect([replaced, moved]).toEqual([{ replaced: true, version: 2 }, { replaced: false }]);
      expect(read).toEqual({ tokens: renewed, version: 2, claimedUntil: undefined });
    });

    it('breaks the connection in the words of an ended consent, a client gone or a key Auto’s consent service does not know, recording the break once', async () => {
      const { h, id } = await connectedByConsent();
      const { tokens } = await consentOf(h);

      const ended = await Effect.runPromise(Effect.flip(tokens.broken('consent_ended')));
      const withoutItsClient = await Effect.runPromise(Effect.flip(tokens.broken('client_gone')));
      const withoutItsKey = await Effect.runPromise(Effect.flip(tokens.broken('key_unknown')));
      const [listed] = await Effect.runPromise(sourceOf(h).connectionsOf('acme'));
      const breaks = (await h.facts()).filter(({ type }) => type === 'connection_broken');

      expect([ended, withoutItsClient, withoutItsKey]).toEqual([
        { because: 'connection_broken', detail: consentEnded },
        { because: 'connection_broken', detail: clientGone },
        { because: 'connection_broken', detail: keyUnknown },
      ]);
      expect(listed?.state).toEqual({
        status: 'unready',
        unready: { because: 'connection_broken', detail: consentEnded },
      });
      expect(breaks).toMatchObject([{ data: { connection: id, reason: consentEnded } }]);
    });
  });

  describe('the tokens of a connection connected by consent, served by the consent client', () => {
    it('are renewed through the row, whose value and version move', async () => {
      const { h, fake } = await connectedByConsent();
      const consent = await consentOf(h);
      const [secretId, first] = onlyRowOf(h);
      const clock = clockAt(Date.parse('2026-10-15T14:00:00.000Z'));
      const source = h.consent.tokenSource(consent, {
        name: 'files',
        holder: `connection ${secretId}`,
        now: clock.now,
        timer: manualTimer().timer,
        hold: Function.constVoid,
      });

      clock.setTo(Date.parse('2026-10-15T14:59:00.000Z'));
      const renewed = await source.token();
      const read = await Effect.runPromise(consent.tokens.read);

      expect(first).not.toContain(renewed);
      expect(read.tokens.access_token).toBe(renewed);
      expect(read.version).toBe(2);
      expect(fake.tokenRequests()).toBe(2);
    });
  });
});

describe('consent endings', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('the ending codes of the way of consent of a provider', () => {
    it('are those its way names when a connection connected by consent is served, and none where it names none', async () => {
      const fake = await consentFake();
      closing.push(fake.close);
      const h = consentHarnessAt(fake);
      const link = await added(h, { provider: 'files' });
      await finishing(h, link, await consentedOf(h, link));
      const ending = filesAt(fake, { ...filesWay, ending_codes: ['invalid_refresh_token', 'token_revoked'] });

      const servedConsentEndings = await Promise.all(
        [ending, filesAt(fake)].map((files) =>
          consentServedAs(sourceOver(h, { policy: loopbackPolicy, providers: providerListOf(files) }), link.id),
        ),
      );

      expect(servedConsentEndings.map(({ way }) => way.ending_codes)).toEqual([
        ['invalid_refresh_token', 'token_revoked'],
        undefined,
      ]);
    });
  });
});

describe('a connection whose provider another provider replaces', () => {
  it('is served to no playbook, whether connected or not yet connected, as one to reconnect, saying how it is used again, and nothing records it broken', async () => {
    const replacing = await replacingFiles();
    const connected = await connectedFiles(replacing);
    const pending = await added(replacing.h, { provider: 'files', name: 'files-two' });
    const source = sourceOver(replacing.h, { providers: replacing.providers, policy: replacingPolicy });
    const recorded = await replacing.h.facts();

    expect((await servedAs(source, connected.id)).state).toEqual({
      status: 'unready',
      unready: { because: 'connection_broken', detail: replacedWords('files') },
    });
    expect((await servedAs(source, pending.id)).state).toEqual({
      status: 'unready',
      unready: { because: 'connection_broken', detail: replacedWords('files-two') },
    });
    expect(await replacing.h.facts()).toEqual(recorded);
  });
});

describe('unreadable credentials', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a connection whose credential the secret store cannot read now', () => {
    it('fails a tool call in words that name no key and no cause, records nothing and stays connected, logs the cause once, and is called once the custodian answers again', async () => {
      const fake = await fakeServerAt();
      const h = harness({ policy: loopbackPolicy });
      const { custodian, store } = sealedIn(memoryRows({ now }));
      const id = await givenThrough(h, store, graphAt(fake), fakeApiKey);
      const pending = await added(h, { ...graphAt(fake), name: 'notes' });
      const { lines, logging } = loggedLines();
      const source = sourceLoggingInto(h, store, logging);
      const { access } = await describedAccess({}, { timing: patientTiming, connections: source });
      closing.push(access.close);
      const calls = playbookToolCalls(access);

      custodian.refuse();
      const refused = [
        await calls.call('execute_connection', searched),
        await calls.call('execute_connection', searched),
      ];
      const listedWhileRefused = (await connectionOf(source, id)).state.status;
      custodian.answer();
      const answered = await calls.call('execute_connection', searched);

      expect(refused).toEqual([refusedCall, refusedCall]);
      expect(listedWhileRefused).toBe('connected');
      expect((await connectionOf(source, pending.id)).state.status).toBe('unready');
      expect(answered).toMatchObject({ status: 'succeeded' });
      expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_broken');
      expect(warningsIn(lines)).toEqual([expect.stringContaining(`"message":"${refusedBy(custodian)}"`)]);
      expect(warningsIn(lines)[0]).toContain(`"annotations":{"org":"acme","connection":"${id}"}`);
      expect(lines.join('\n')).not.toContain(fakeApiKey);
    });
  });

  describe('the log of a credential that cannot be read now', () => {
    it('holds each cause once, by the failure and the key it names and not by its words, again when the cause changes, and again once a read succeeded between', async () => {
      const fake = await fakeServerAt();
      const h = harness({ policy: loopbackPolicy });
      const rows = memoryRows({ now });
      const { custodian, store } = sealedIn(rows);
      const id = await givenThrough(h, store, graphAt(fake), fakeApiKey);
      const secretId = String(rows.kept()[0]?.id);
      const other = sealedIn(rows);
      const { lines, logging } = loggedLines();
      const source = sourceLoggingInto(h, store, logging);

      custodian.refuse();
      const refusals = [await refusalOf(source, id), await refusalOf(source, id)];
      custodian.answer();
      await wrappedAgainBadly(rows, custodian.kid);
      refusals.push(await refusalOf(source, id));
      await Effect.runPromise(other.store.replace(secretId, 1, Redacted.make(fakeApiKey)));
      refusals.push(await refusalOf(source, id), await refusalOf(source, id));
      await Effect.runPromise(store.replace(secretId, 2, Redacted.make(fakeApiKey)));
      await Effect.runPromise(servedOf(await connectionOf(source, id)));
      custodian.refuse();
      refusals.push(await refusalOf(source, id));

      const keyUnknownUnreadableCredentials = loggedCause(
        `The secret is sealed under the key ${other.custodian.kid}, which is neither the current key nor the previous one`,
      );
      const unopened = loggedCause(
        `The custodian of the key ${custodian.kid} refused to unwrap a data key: its wrapped key does not open under this key`,
      );
      expect(refusals).toEqual(refusals.map(() => ({ because: 'connection_unavailable', detail: unreadableNow })));
      expect(refusals).toHaveLength(6);
      expect(
        warningsIn(lines).map((line) => [line.includes(keyUnknownUnreadableCredentials), line.includes(unopened)]),
      ).toEqual([
        [false, false],
        [true, false],
        [false, false],
      ]);
    });
  });

  describe('a connection whose custodian does not answer', () => {
    it('is unavailable once the store has waited 10 seconds, and never broken', async () => {
      const fake = await fakeServerAt();
      const h = harness({ policy: loopbackPolicy });
      const { custodian, store } = sealedIn(memoryRows({ now }));
      const id = await givenThrough(h, store, graphAt(fake), fakeApiKey);
      const servedUnreadableCredentials = servedOf(
        await connectionOf(sourceLoggingInto(h, store, loggedLines().logging), id),
      );

      const refused = await Effect.runPromise(
        Effect.gen(function* () {
          const asked = custodian.stall();
          const serving = yield* Effect.forkChild(Effect.flip(servedUnreadableCredentials));
          yield* Effect.promise(() => asked);
          yield* TestClock.adjust('10 seconds');
          return yield* Fiber.join(serving);
        }).pipe(Effect.provide(TestClock.layer())),
      );

      expect(refused).toEqual({
        because: 'connection_unavailable',
        detail: unreadableNow,
      });
      expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_broken');
    });
  });
});
