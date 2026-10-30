import { keptTokensIn, type SecretReadingFailure } from '@on.auto/tool-servers';
import { admitted, consentedAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect, Option, Redacted, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, reconnected, type Added } from '../testing/additions.ts';
import {
  appSecret,
  connectedThrough,
  consentHarnessAt,
  finishing,
  givingTheClient,
  orgsAppFake,
  startedAt,
  studioReturn,
  underTheOrgsApp,
} from '../testing/consents.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const RegisteredSchema = Schema.Struct({ client_id: Schema.String, client_secret: Schema.String });

async function anAppRegisteredAt(fake: FakeMcpServer) {
  const answer = await fetch(`${fake.origin}/register`, {
    method: 'POST',
    body: JSON.stringify({ redirect_uris: [studioReturn] }),
  });
  return Schema.decodeUnknownSync(RegisteredSchema)(await answer.json());
}

interface Connected {
  readonly fake: FakeMcpServer;
  readonly h: Harness;
  readonly link: Added;
  readonly accessToken: string;
}

function tokensKeptIn(h: Harness, secretId: string) {
  const kept = Option.fromNullishOr(h.secrets.values().get(secretId));
  return Option.getOrThrow(Option.flatMap(kept, (value) => keptTokensIn(Redacted.make(value))));
}

async function connectedUnderTheOrgsApp(): Promise<Connected> {
  const fake = await orgsAppFake({ dynamicRegistration: true });
  closing.push(fake.close);
  const h = consentHarnessAt(fake);
  const link = await added(h, underTheOrgsApp);
  await givingTheClient(h, link);
  await connectedThrough(h, link);
  return { fake, h, link, accessToken: tokensKeptIn(h, 'secret-3').access_token };
}

function keptValues(h: Harness): readonly string[] {
  return [...h.secrets.values().values()];
}

function readingOf(h: Harness, { id, token }: Added) {
  return h.call(operationNamed(h.operations, 'read_link'), ada, { id, token });
}

const clientSecretUnread: SecretReadingFailure = {
  _tag: 'keeper_unavailable',
  detail: 'The secret manager did not answer',
};

function readingAllButTheClient(h: Harness): Harness['secrets']['read'] {
  return (secretId) => (secretId === 'secret-1' ? Effect.fail(clientSecretUnread) : h.secrets.read(secretId));
}

describe('another client of the org’s own app, given while the connection holds tokens', () => {
  it('is kept as its next client: the record keeps the client it runs under, and its next sign-in takes the one given', async () => {
    const { fake, h, link, accessToken } = await connectedUnderTheOrgsApp();
    const renewed = await anAppRegisteredAt(fake);

    const again = await reconnected(h, link.id);
    const given = await givingTheClient(h, again, renewed);
    const read = await readingOf(h, again);
    const { url } = await startedAt(h, again);

    expect([given, read]).toMatchObject([
      {
        status: 'succeeded',
        output: { status: 'connected', credential: { client_id: 'org-app' }, next_client_id: renewed.client_id },
      },
      {
        status: 'succeeded',
        output: { credential: { client_id: 'org-app' }, client_source: 'own', next_client_id: renewed.client_id },
      },
    ]);
    expect(new URL(url).searchParams.get('client_id')).toBe(renewed.client_id);
    expect(keptValues(h)).toEqual(expect.arrayContaining([appSecret, renewed.client_secret]));
    expect(await admitted(fake, accessToken)).toBe(true);
  });

  it('becomes the client it runs under once that sign-in connects it, the tokens before revoked with the client they were given to and its secret forgotten', async () => {
    const { fake, h, link, accessToken } = await connectedUnderTheOrgsApp();
    const renewed = await anAppRegisteredAt(fake);
    const again = await reconnected(h, link.id);
    await givingTheClient(h, again, renewed);

    const { url } = await startedAt(h, again);
    const connected = await finishing(h, again, await consentedAt(url));
    const tokens = tokensKeptIn(h, 'secret-6');

    expect(connected).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', credential: { client_id: renewed.client_id, client_source: 'own' } },
    });
    expect(await admitted(fake, accessToken)).toBe(false);
    expect(await admitted(fake, tokens.access_token)).toBe(true);
    expect(keptValues(h)).toContain(renewed.client_secret);
    expect(keptValues(h)).not.toContain(appSecret);
  });
});

describe('a next client of the org’s own app, given again', () => {
  it('replaces the next client given before it, whose secret alone is forgotten', async () => {
    const { fake, h, link } = await connectedUnderTheOrgsApp();
    const [first, second] = [await anAppRegisteredAt(fake), await anAppRegisteredAt(fake)];
    const again = await reconnected(h, link.id);

    await givingTheClient(h, again, first);
    await givingTheClient(h, again, second);
    const { url } = await startedAt(h, again);

    expect(keptValues(h)).toEqual(expect.arrayContaining([appSecret, second.client_secret]));
    expect(keptValues(h)).not.toContain(first.client_secret);
    expect(new URL(url).searchParams.get('client_id')).toBe(second.client_id);
  });
});

describe('the client id a connection under the org’s own app runs under, given again while it holds tokens', () => {
  it('replaces the secret of that client at once, and drops a next client given before it', async () => {
    const { fake, h, link } = await connectedUnderTheOrgsApp();
    const renewed = await anAppRegisteredAt(fake);
    const rotated = { client_id: 'org-app', client_secret: 'the-org-app-rotated-secret-77b1' };
    const again = await reconnected(h, link.id);
    await givingTheClient(h, again, renewed);

    const given = await givingTheClient(h, again, rotated);
    const { url } = await startedAt(h, again);

    expect(given).toMatchObject({ status: 'succeeded', output: { credential: { client_id: 'org-app' } } });
    expect(given).not.toHaveProperty('output.next_client_id');
    expect(keptValues(h)).toContain(rotated.client_secret);
    expect(keptValues(h)).not.toContain(appSecret);
    expect(keptValues(h)).not.toContain(renewed.client_secret);
    expect(new URL(url).searchParams.get('client_id')).toBe('org-app');
  });
});

describe('the clients of a connection under the org’s own app, as it is removed', () => {
  it('are forgotten, the client it runs under and a next client alike, after its tokens are revoked with the client they were given to', async () => {
    const { fake, h, link, accessToken } = await connectedUnderTheOrgsApp();
    await givingTheClient(h, await reconnected(h, link.id), await anAppRegisteredAt(fake));

    const removed = await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect([...h.secrets.values()]).toEqual([]);
    expect(await admitted(fake, accessToken)).toBe(false);
  });

  it('logs in the store’s words that its tokens were not revoked where the client secret they were given to cannot be read now', async () => {
    const { fake, h, link, accessToken } = await connectedUnderTheOrgsApp();
    const operations = h.operationsWith({ secrets: { ...h.secrets, read: readingAllButTheClient(h) } });

    const removed = await h.call(operationNamed(operations, 'remove_connection'), ada, { id: link.id });

    expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(h.logged().join('\n')).toContain(
      "The tokens of the connection files were not revoked, since the client secret of the org's own app they were given to cannot be read now, so they end on their own: The secret manager did not answer",
    );
    expect([...h.secrets.values()]).toEqual([]);
    expect(await admitted(fake, accessToken)).toBe(true);
  });
});
