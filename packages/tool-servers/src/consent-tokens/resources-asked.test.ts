import { Effect, Option, Redacted, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConsentClient, FinishAsked, FinishedConsent, StartAsked } from '../consent/consent-client.ts';
import {
  admitted,
  clockAt,
  consentClientAt,
  consentClientWith,
  finishAskedOf,
  hostOf,
  registeredAt,
  returnAddress,
  rowOf,
  servedOf,
  servedTokensOf,
  startAskedAt,
  tokensKeptBy,
  type ClientRegistration,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return fake;
}

const api = 'https://api.files.example.com';

const hooks = 'https://hooks.files.example.com';

const reports = 'https://reports.files.example.com';

const requestOrigins = [api, hooks];

type Pairs = readonly (readonly [string, string])[];

const unrepeated: ReadonlySet<string> = new Set(['code', 'code_challenge', 'code_verifier']);

function masked(pairs: Iterable<readonly [string, string]>): Pairs {
  return [...pairs].map(([name, value]: readonly [string, string]) => [name, unrepeated.has(name) ? 'masked' : value]);
}

function resourcesIn(pairs: Pairs): readonly string[] {
  return pairs.filter(([name]) => name === 'resource').map(([, value]) => value);
}

function tokenFormsSent(refusingSeveral = false) {
  const forms: Pairs[] = [];
  const fetch = async (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    const form = new URLSearchParams(await request.clone().text());
    if (form.has('grant_type')) {
      forms.push([...form]);
    }
    return refusingSeveral && form.getAll('resource').length > 1
      ? Response.json({ error: 'invalid_target' }, { status: 400 })
      : globalThis.fetch(request);
  };
  return { fetch, forms: () => [...forms] };
}

async function startedAt(client: ConsentClient, asked: StartAsked): Promise<URLSearchParams> {
  return new URL((await Effect.runPromise(client.start(asked))).url).searchParams;
}

function finished(client: ConsentClient, asked: FinishAsked): Promise<FinishedConsent> {
  return Effect.runPromise(client.finish(asked).pipe(Effect.provide(TestClock.layer())));
}

const decodeKept = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

function keptKeysOf({ tokens }: FinishedConsent): readonly string[] {
  return Object.keys(decodeKept(Redacted.value(tokens)));
}

describe('the resources a start asks for', () => {
  it("are its server's, then one for each origin its entry's requests name", async () => {
    const fake = await served();
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });

    const asked = await startedAt(client, { ...startAskedAt(fake), requestOrigins });

    expect(asked.getAll('resource')).toEqual([fake.url, ...requestOrigins]);
  });

  it('are none where the server publishes no resource of its own, whatever origins its entry names', async () => {
    const fake = await served({ publishesMetadata: false });
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });
    const endpoints = { authorization_endpoint: `${fake.origin}/authorize`, token_endpoint: `${fake.origin}/token` };

    const asked = await startedAt(client, { ...startAskedAt(fake, endpoints), requestOrigins });

    expect(asked.getAll('resource')).toEqual([]);
  });

  it("leave a start whose entry declares no request as it was, every parameter in its place and its server's resource once", async () => {
    const fake = await served();
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });
    const way = {
      scope: 'files.read offline_access',
      parameters: { access_type: 'offline', prompt: 'select_account' },
    };

    const before = masked(await startedAt(client, startAskedAt(fake, way)));
    const after = masked(await startedAt(client, { ...startAskedAt(fake, way), requestOrigins: [] }));

    expect([before, after]).toEqual([
      [
        ['response_type', 'code'],
        ['client_id', 'auto-runtime'],
        ['code_challenge', 'masked'],
        ['code_challenge_method', 'S256'],
        ['redirect_uri', returnAddress],
        ['state', 'state-1'],
        ['scope', 'files.read offline_access'],
        ['prompt', 'select_account'],
        ['resource', fake.url],
        ['access_type', 'offline'],
      ],
      before,
    ]);
  });
});

describe('the resources a finish redeems the code for', () => {
  it("are those its start asked, which it keeps with the tokens, the origins of its entry's requests", async () => {
    const fake = await served();
    const sent = tokenFormsSent();
    const client = consentClientWith({ fetch: sent.fetch, registeredClients: [registeredAt(fake.origin)] });

    const done = await finished(client, await finishAskedOf(client, { ...startAskedAt(fake), requestOrigins }));

    expect(sent.forms().map((form) => resourcesIn(form))).toEqual([[fake.url, ...requestOrigins]]);
    expect(tokensKeptBy(done).resources).toEqual(requestOrigins);
    expect(await admitted(fake, tokensKeptBy(done).access_token)).toBe(true);
  });

  it("are its server's alone where its entry declares no request, the exchange and the value kept as they were", async () => {
    const fake = await served();
    const sent = tokenFormsSent();
    const client = consentClientWith({ fetch: sent.fetch, registeredClients: [registeredAt(fake.origin)] });

    const done = [
      await finished(client, await finishAskedOf(client, startAskedAt(fake))),
      await finished(client, await finishAskedOf(client, { ...startAskedAt(fake), requestOrigins: [] })),
    ];
    const exchange: Pairs = [
      ['grant_type', 'authorization_code'],
      ['code', 'masked'],
      ['code_verifier', 'masked'],
      ['redirect_uri', returnAddress],
      ['resource', fake.url],
    ];

    expect(sent.forms().map((form) => masked(form))).toEqual([exchange, exchange]);
    expect(done.map((consent) => keptKeysOf(consent))).toEqual([
      ['access_token', 'refresh_token', 'expires_at', 'scope', 'token_type'],
      ['access_token', 'refresh_token', 'expires_at', 'scope', 'token_type'],
    ]);
  });
});

describe('a finish whose server refuses a resource it asks for', () => {
  it('ends as any refused exchange ends, asked once and never again with fewer', async () => {
    const fake = await served();
    const sent = tokenFormsSent(true);
    const client = consentClientWith({ fetch: sent.fetch, registeredClients: [registeredAt(fake.origin)] });
    const asked = await finishAskedOf(client, { ...startAskedAt(fake), requestOrigins });

    expect(await Effect.runPromise(Effect.flip(client.finish(asked)))).toEqual({
      refused: 'unanswered',
      call: {
        step: 'token',
        host: hostOf(fake),
        answer: { status: 400, retryAfterMs: null, errorCode: 'invalid_target' },
      },
    });
    expect(sent.forms()).toHaveLength(1);
  });
});

const renewalTime = 3_540_000;

async function renewingWith(signedInFor: readonly string[], declaredNow: readonly string[]) {
  const fake = await served();
  const sent = tokenFormsSent();
  const consent = consentClientAt(fake, { fetch: sent.fetch });
  const asked = await finishAskedOf(consent, { ...startAskedAt(fake), requestOrigins: signedInFor });
  const done = await finished(consent, asked);
  const connected = { fake, client: asked.client, tokens: done.tokens, kept: tokensKeptBy(done) };
  const clock = clockAt(0);
  const row = rowOf(connected, clock.now);
  const { source } = servedTokensOf({ ...servedOf(connected, row), requestOrigins: declaredNow }, clock.now, consent);
  const recorded = () => source.recordedResources?.();
  const renewed = async () => {
    clock.setTo(renewalTime);
    await source.token();
    return {
      asked: sent
        .forms()
        .slice(1)
        .map((form) => resourcesIn(form)),
      kept: Option.fromNullishOr(row.kept()),
    };
  };
  return { fake, recorded, renewed };
}

describe('the resources a renewal asks for', () => {
  it("are its server's and those its tokens were asked for that the entry still declares, never one it declared later", async () => {
    const { fake, recorded, renewed } = await renewingWith([api, hooks], [api, reports]);

    const before = recorded();
    const { asked, kept } = await renewed();

    expect([before, asked, Option.map(kept, ({ resources }) => resources), recorded()]).toEqual([
      [api, hooks],
      [[fake.url, api]],
      Option.some([api]),
      [api],
    ]);
  });

  it("are its server's alone for tokens that record none, which it keeps recording none", async () => {
    const { fake, recorded, renewed } = await renewingWith([], [api]);

    const { asked, kept } = await renewed();

    expect([asked, Option.map(kept, (tokens) => Object.keys(tokens)), recorded()]).toEqual([
      [[fake.url]],
      Option.some(['access_token', 'refresh_token', 'expires_at', 'scope', 'token_type']),
      [],
    ]);
  });
});
