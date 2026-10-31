import type { Outcome } from '@on.auto/operations';
import { consentedAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, lastFact, type Added } from '../testing/additions.ts';
import {
  orgsClientSecret,
  consentHarnessAt,
  finishing,
  givingTheClient,
  orgsOAuthClientFake,
  startedAt,
  studioReturn,
  theOrgsOAuthClient,
  underTheOrgsOAuthClient,
} from '../testing/consents.ts';
import { acmeWriter, ada, grace, loopbackAndCrmPolicy, operationNamed, type Harness } from '../testing/harness.ts';
import { calledThrough, sealedConsentAt } from '../testing/sealed-consents.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(): Promise<FakeMcpServer> {
  const fake = await orgsOAuthClientFake();
  closing.push(fake.close);
  return fake;
}

async function underTheOrgsOAuthClientAt(options: Parameters<typeof consentHarnessAt>[1] = {}) {
  const h = consentHarnessAt(await served(), options);
  return { h, link: await added(h, underTheOrgsOAuthClient) };
}

function readingOf(h: Harness, { id, token }: Added): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'read_link'), acmeWriter, { id, token });
}

const unkeptNow: unknown = expect.stringMatching(
  /^The client secret of the organization's own OAuth client for the connection files cannot be kept now, so nothing is changed and its link stays open: The custodian of the key /u,
);

const anotherClient = { client_id: 'another-app', client_secret: 'another-app-client-secret-0c4f' };

describe('the organization’s own OAuth client a person gives on the page', () => {
  it('is kept sealed in the secret store and recorded by its client id alone, and the link stays open for the sign-in', async () => {
    const { h, link } = await underTheOrgsOAuthClientAt();

    const given = await givingTheClient(h, link);
    const read = await readingOf(h, link);

    expect(given).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'pending',
        credential: { kind: 'authorization', client_source: 'own', client_id: 'org-app' },
        credential_ends_with: null,
      },
    });
    expect(await lastFact(h)).toEqual({ connection: link.id, client_id: 'org-app', secret_id: 'secret-1' });
    expect([...h.secrets.values().values()]).toEqual([orgsClientSecret]);
    expect(JSON.stringify([given, read, await h.facts()])).not.toContain(orgsClientSecret);
    expect(read).toMatchObject({
      status: 'succeeded',
      output: {
        credential: { client_id: 'org-app', client_source: 'own' },
        client_source: 'own',
        return_address: studioReturn,
      },
    });
  });
});

describe('the organization’s own OAuth client given again', () => {
  it('replaces the client given before, whose secret is forgotten', async () => {
    const { h, link } = await underTheOrgsOAuthClientAt();

    await givingTheClient(h, link);
    const replaced = await givingTheClient(h, link, anotherClient);

    expect(replaced).toMatchObject({ status: 'succeeded', output: { credential: { client_id: 'another-app' } } });
    expect([...h.secrets.values().values()]).toEqual([anotherClient.client_secret]);
  });

  it('forgets the secret of the client its record replaced, where another give was recorded while it was given', async () => {
    const meanwhile: { give: () => Promise<unknown> } = { give: () => Promise.resolve() };
    const { h, link } = await underTheOrgsOAuthClientAt({ beforeKeeping: () => meanwhile.give() });
    meanwhile.give = () => {
      meanwhile.give = () => Promise.resolve();
      return givingTheClient(h, link, anotherClient);
    };

    const given = await givingTheClient(h, link);

    expect(given).toMatchObject({ status: 'succeeded', output: { credential: { client_id: 'org-app' } } });
    expect([...h.secrets.values().values()]).toEqual([orgsClientSecret]);
  });

  it('leaves a consent begun under the client before unfinishable, the person signing in again under the client given last', async () => {
    const { h, link } = await underTheOrgsOAuthClientAt();
    await givingTheClient(h, link);
    const { url } = await startedAt(h, link);

    await givingTheClient(h, link, anotherClient);
    const finished = await finishing(h, link, await consentedAt(url));

    expect(finished).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail:
        "The organization's own OAuth client for the connection files was given again meanwhile, so the person signs in again under the client given last",
    });
    expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_connected');
  });
});

describe('the person who gives the organization’s own OAuth client', () => {
  it('is the person who added the connection alone, where the runtime signs people in', async () => {
    const { h, link } = await underTheOrgsOAuthClientAt();

    const refused = await givingTheClient(h, link, theOrgsOAuthClient, grace);

    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The connection files was added by another person, and only they may approve it',
    });
    expect([...h.secrets.values()]).toEqual([]);
  });

  it('is anyone who holds the link, where the runtime signs nobody in', async () => {
    const { h, link } = await underTheOrgsOAuthClientAt({ access: 'local' });

    expect(await givingTheClient(h, link, theOrgsOAuthClient, grace)).toMatchObject({ status: 'succeeded' });
  });
});

describe('a client given for a connection that does not run under the organization’s own OAuth client', () => {
  it('is refused, and nothing is kept', async () => {
    const h = consentHarnessAt(await served(), { policy: loopbackAndCrmPolicy });
    const byAutosClient = await added(h, { provider: 'files' });
    const bySecret = await added(h, crm);

    expect([await givingTheClient(h, byAutosClient), await givingTheClient(h, bySecret)]).toMatchObject([
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          "The connection files does not run under the organization's own OAuth client, so it takes no client to give",
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          "The connection crm does not run under the organization's own OAuth client, so it takes no client to give",
      },
    ]);
    expect([...h.secrets.values()]).toEqual([]);
  });
});

describe('the organization’s own OAuth client whose secret the secret store does not keep', () => {
  it('is refused at the client secret where the store refuses it, and nothing is recorded', async () => {
    const { h, link } = await underTheOrgsOAuthClientAt({ mostSecretCharacters: 16 });

    const refused = await givingTheClient(h, link);

    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The client cannot be taken as it is given',
      issues: [{ pointer: '/client_secret', detail: 'A secret to keep holds more than 16 characters' }],
    });
    expect((await h.facts()).map(({ type }) => type)).toEqual(['connection_added', 'connection_link_issued']);
  });

  it('is answered unavailable in the words of the store where it cannot keep the secret now, keeping nothing', async () => {
    const sealed = sealedConsentAt(await served());
    const link = await added(sealed.h, underTheOrgsOAuthClient);

    sealed.custodian.refuse();
    const refused = await calledThrough(sealed, 'give_client', {
      id: link.id,
      token: link.token,
      ...theOrgsOAuthClient,
    });

    expect(refused).toMatchObject({ status: 'rejected', reason: 'unavailable', detail: unkeptNow });
    expect((await sealed.h.facts()).map(({ type }) => type)).toEqual(['connection_added', 'connection_link_issued']);
  });
});

describe('the organization’s own OAuth client given through a link that does not stand', () => {
  it('forgets the secret it kept when the connection changed before the client was recorded', async () => {
    const removal: { run: () => Promise<unknown> } = { run: () => Promise.resolve() };
    const { h, link } = await underTheOrgsOAuthClientAt({ beforeKeeping: () => removal.run() });
    removal.run = () => h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    expect(await givingTheClient(h, link)).toMatchObject({ status: 'rejected', reason: 'not_found' });
    expect([...h.secrets.values()]).toEqual([]);
  });

  it('is refused through a link that is not open', async () => {
    const { h, link } = await underTheOrgsOAuthClientAt();

    expect(await givingTheClient(h, { id: link.id, token: 'a-token-of-no-link' })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
  });
});
