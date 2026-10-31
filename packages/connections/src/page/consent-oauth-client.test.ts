import { keptTokensIn, type ConsentClient } from '@on.auto/tool-servers';
import { servedThroughAuto, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { admitted, autoClientsOf, consentedAt, type ClientRegistration } from '@on.auto/tool-servers/testing';
import { Effect, Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, type Added } from '../testing/additions.ts';
import {
  orgsClientSecret,
  connectedThrough,
  consentHarnessAt,
  finishing,
  givingTheClient,
  orgsOAuthClientFake,
  startedAt,
  starting,
  theOrgsOAuthClient,
  underTheOrgsOAuthClient,
} from '../testing/consents.ts';
import { ada, loopbackAndCrmPolicy, operationNamed, type Harness } from '../testing/harness.ts';
import { calledThrough, sealedConsentAt } from '../testing/sealed-consents.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await orgsOAuthClientFake(changes);
  closing.push(fake.close);
  return fake;
}

interface UnderTheOrgsOAuthClient {
  readonly fake: FakeMcpServer;
  readonly h: Harness;
  readonly link: Added;
}

async function givenUnderTheOrgsOAuthClient(
  changes: Partial<ClientRegistration> = {},
): Promise<UnderTheOrgsOAuthClient> {
  const fake = await served(changes);
  const h = consentHarnessAt(fake);
  const link = await added(h, underTheOrgsOAuthClient);
  await givingTheClient(h, link);
  return { fake, h, link };
}

function sourcesCounted(consent: ConsentClient) {
  const counted = { times: 0 };
  const counting: ConsentClient = {
    ...consent,
    hadSources: (studioBase) =>
      Effect.suspend(() => {
        counted.times += 1;
        return consent.hadSources(studioBase);
      }),
  };
  return { consent: counting, asked: () => counted.times };
}

function typesOf(facts: readonly { readonly type: string }[]): readonly string[] {
  return facts.map(({ type }) => type);
}

function tokensKeptIn(h: Harness, secretId: string) {
  const kept = Option.fromNullishOr(h.secrets.values().get(secretId));
  return Option.getOrThrow(Option.flatMap(kept, (value) => keptTokensIn(Redacted.make(value))));
}

const unreadNow: unknown = expect.stringMatching(
  /^The consent of the connection files cannot go on now, since the runtime cannot read the client secret of the organization's own OAuth client: The custodian of the key /u,
);

const clientGone =
  "The client secret of the organization's own OAuth client for the connection files is no longer in the secret store, so the person gives its client ID and client secret again on its page";

describe('the consent of a connection under the organization’s own OAuth client', () => {
  it('is refused until the organization’s own OAuth client is given on the page, and nothing is started', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, underTheOrgsOAuthClient);

    expect(await starting(h, link)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail:
        "The connection files runs under the organization's own OAuth client, whose client ID and client secret the person gives on its page before signing in",
    });
    expect(typesOf(await h.facts())).toEqual(['connection_added', 'connection_link_issued']);
  });

  it('starts at the provider’s authorization endpoint with the org’s client, and the finish connects it with that client', async () => {
    const { fake, h, link } = await givenUnderTheOrgsOAuthClient();

    const { url } = await startedAt(h, link);
    const finished = await finishing(h, link, await consentedAt(url));
    const facts = await h.facts();

    expect([`${new URL(url).origin}${new URL(url).pathname}`, new URL(url).searchParams.get('client_id')]).toEqual([
      `${fake.origin}/authorize`,
      'org-app',
    ]);
    expect(finished).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', credential: { client_id: 'org-app', client_source: 'own' } },
    });
    expect(facts.filter(({ type }) => type === 'connection_consent_started')).toMatchObject([
      { data: { client_id: 'org-app', client_source: 'own' } },
    ]);
    expect(facts.at(-1)).toMatchObject({
      type: 'connection_connected',
      data: { client_id: 'org-app', client_source: 'own' },
    });
    expect(await admitted(fake, tokensKeptIn(h, 'secret-3').access_token)).toBe(true);
    expect(JSON.stringify(facts)).not.toContain(orgsClientSecret);
  });
});

describe('the consent of a connection under the organization’s own OAuth client, where Auto’s clients are on', () => {
  it('never begins through Auto’s consent service, though Auto has a client at the provider', async () => {
    const serving = await servedThroughAuto({ clientId: theOrgsOAuthClient.client_id, clientSecret: orgsClientSecret });
    closing.push(serving.close);
    const h = consentHarnessAt(serving.fake, {
      policy: loopbackAndCrmPolicy,
      consenting: { autoClients: autoClientsOf(serving.service) },
      pages: {
        studio: { origin: 'https://studio.example.com', served: false },
        runtime: () => 'http://localhost:5555',
      },
    });
    const link = await added(h, underTheOrgsOAuthClient);
    await givingTheClient(h, link);
    const askedBefore = serving.service.calls().length;

    const connected = await connectedThrough(h, link);

    expect(connected).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(serving.service.calls()).toHaveLength(askedBefore);
  });

  it('asks for the client sources the runtime has only as it is added, since the org’s client is its one source after', async () => {
    const harnessed = consentHarnessAt(await served());
    const counting = sourcesCounted(harnessed.consent);
    const h: Harness = { ...harnessed, operations: harnessed.operationsWith({ consent: counting.consent }) };
    const link = await added(h, underTheOrgsOAuthClient);
    await givingTheClient(h, link);

    const read = await h.call(operationNamed(h.operations, 'read_link'), ada, { id: link.id, token: link.token });
    const started = await starting(h, link);

    expect([read, started]).toMatchObject([
      { status: 'succeeded', output: { client_source: 'own' } },
      { status: 'succeeded', output: { client_source: 'own' } },
    ]);
    expect(counting.asked()).toBe(1);
  });
});

describe('the consent of a connection under the organization’s own OAuth client whose client secret is not had', () => {
  it('is unavailable where the client secret cannot be read now, and nothing is started', async () => {
    const sealed = sealedConsentAt(await served());
    const link = await added(sealed.h, underTheOrgsOAuthClient);
    await calledThrough(sealed, 'give_client', { id: link.id, token: link.token, ...theOrgsOAuthClient });

    sealed.custodian.refuse();
    const unread = await calledThrough(sealed, 'start', { id: link.id, token: link.token });

    expect(unread).toMatchObject({ status: 'rejected', reason: 'unavailable', detail: unreadNow });
    expect(typesOf(await sealed.h.facts())).not.toContain('connection_consent_started');
  });

  it('asks for the client again where its secret is no longer in the secret store, at the start or at the finish', async () => {
    const { h, link } = await givenUnderTheOrgsOAuthClient();
    const { url } = await startedAt(h, link);
    await Effect.runPromise(h.secrets.forget('secret-1'));

    expect([await finishing(h, link, await consentedAt(url)), await starting(h, link)]).toMatchObject([
      { status: 'rejected', reason: 'conflict', detail: clientGone },
      { status: 'rejected', reason: 'conflict', detail: clientGone },
    ]);
  });
});
