import { mail, providerListOf, providerOf, signingInToMail } from '@on.auto/providers/testing';
import { readToolServerSettings } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { makeProviderResolver } from '../providers/provider-resolver.ts';
import { added, crm, lastFact } from '../testing/additions.ts';
import { documentsOffTheLoopback } from '../testing/harness-services.ts';
import { ada, harness, operationNamed, recordedAs, type Harness, type HarnessOptions } from '../testing/harness.ts';
import { preparedOf, sourceOver } from '../testing/served-connections.ts';
import {
  asTheServiceAccount,
  inbox,
  otherPartsOfTheFile,
  robot,
  serviceAccountAt,
  type ServiceAccount,
} from '../testing/service-accounts.ts';

const anyWords: unknown = expect.any(String);

const namingTheCode: unknown = expect.stringContaining('unauthorized_client');

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function accountAt(subjects?: readonly string[], namedIssuer?: string): ServiceAccount {
  const account = serviceAccountAt({
    ...(subjects === undefined ? {} : { subjects }),
    ...(namedIssuer === undefined ? {} : { namedIssuer }),
  });
  closing.push(account.issuer.close);
  return account;
}

function harnessOf({ providers }: ServiceAccount, changes: HarnessOptions = {}): Harness {
  return harness({ providers, mostSecretCharacters: 4096, ...changes });
}

function giving(h: Harness, input: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'give_credential'), ada, input);
}

function bodyOf(privateKey: string): string {
  return privateKey.split('\n').slice(1, -2).join('');
}

describe('a key file given for a connection that signs an assertion', () => {
  it('is checked with the authorization server before anything is kept, then its private key alone is kept and its client named', async () => {
    const account = accountAt();
    const askedWhenKept: number[] = [];
    const h = harnessOf(account, {
      beforeKeeping: () => Promise.resolve(askedWhenKept.push(account.issuer.tokenRequests())),
    });
    const { id, token } = await added(h, asTheServiceAccount);

    const given = await giving(h, { id, token, key_file: account.keyFile });

    expect(given).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'connected', credential: { kind: 'jwt_bearer', subject: inbox, client_id: robot } },
    });
    expect(askedWhenKept).toEqual([1]);
    expect([...h.secrets.values().values()]).toEqual([account.privateKey]);
    expect(await lastFact(h)).toEqual({
      connection: id,
      secret_id: 'secret-1',
      algorithm: 'RS256',
      client_id: robot,
      connected_by: recordedAs.ada,
    });
  });

  it('is served as the account the way names, a token asked by a signed assertion for the mailbox, and is in no fact, answer or log', async () => {
    const account = accountAt();
    const h = harnessOf(account);
    const { id, token } = await added(h, asTheServiceAccount);

    const given = await giving(h, { id, token, key_file: account.keyFile });
    const { settings } = await preparedOf(sourceOver(h, { providers: account.providers }), id);
    const written = JSON.stringify([given, await h.facts(), h.logged()]);

    expect(settings.auth).toMatchObject({
      issuer: account.issuer.origin,
      client_id: robot,
      scope: 'mail.read',
      grant: 'jwt_bearer',
      subject: inbox,
      credential: { kind: 'private_key', algorithm: 'RS256' },
    });
    expect(
      [bodyOf(account.privateKey), ...Object.values(otherPartsOfTheFile)].filter((part) => written.includes(part)),
    ).toEqual([]);
  });
});

describe('a key file the runtime does not keep', () => {
  it('is refused at its field where it is not a key file the way can read, leaving the link open for the right one', async () => {
    const account = accountAt();
    const h = harnessOf(account);
    const { id, token } = await added(h, asTheServiceAccount);

    expect(await giving(h, { id, token, key_file: '{"client_email":"robot@acme.example.com"}' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/key_file', detail: anyWords }],
    });
    expect([h.secrets.values().size, account.issuer.tokenRequests()]).toEqual([0, 0]);
    expect(await giving(h, { id, token, key_file: account.keyFile })).toMatchObject({ status: 'succeeded' });
  });

  it('is refused with the code the authorization server answers where it refuses the assertion, keeping nothing', async () => {
    const account = accountAt([]);
    const h = harnessOf(account);
    const { id, token } = await added(h, asTheServiceAccount);

    expect(await giving(h, { id, token, key_file: account.keyFile })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '', detail: namingTheCode }],
    });
    expect(h.secrets.values().size).toBe(0);
  });
});

describe('a key file the runtime cannot check or keep', () => {
  it('answers unavailable, keeping nothing, where the authorization server cannot be reached', async () => {
    const account = accountAt();
    const h = harnessOf(account, { fetch: () => Promise.reject(new TypeError('fetch failed')) });
    const { id, token } = await added(h, asTheServiceAccount);

    expect(await giving(h, { id, token, key_file: account.keyFile })).toMatchObject({ reason: 'unavailable' });
    expect(h.secrets.values().size).toBe(0);
  });

  it('is refused at its field where the provider no longer states the way, or the client it names looks like a credential', async () => {
    const account = accountAt();
    const h = harnessOf(account);
    const first = await added(h, asTheServiceAccount);
    const second = await added(h, { ...asTheServiceAccount, name: 'inbox' });
    const signingInAlone = providerListOf(providerOf({ ...mail, credentials: [signingInToMail] }));
    const givingThere = operationNamed(h.operationsWith({ providers: signingInAlone }), 'give_credential');
    const credentialAsClient = account.keyFile.replace(robot, 'sk-live-0123456789abcdefghij');

    expect(
      await Promise.all([
        h.call(givingThere, ada, { id: first.id, token: first.token, key_file: account.keyFile }),
        giving(h, { id: second.id, token: second.token, key_file: credentialAsClient }),
      ]),
    ).toMatchObject([
      { reason: 'invalid_input', issues: [{ pointer: '/key_file', detail: anyWords }] },
      { reason: 'invalid_input', issues: [{ pointer: '/key_file', detail: anyWords }] },
    ]);
  });

  it('is refused at its field, after its check, where the secret store does not take its private key', async () => {
    const account = accountAt();
    const h = harnessOf(account, { mostSecretCharacters: 64 });
    const { id, token } = await added(h, asTheServiceAccount);

    expect(await giving(h, { id, token, key_file: account.keyFile })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/key_file', detail: anyWords }],
    });
    expect([h.secrets.values().size, account.issuer.tokenRequests()]).toEqual([0, 1]);
  });
});

function tokensAnsweredWith(status: number) {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address).endsWith('/token')
      ? Promise.resolve(new Response('Bad Request', { status }))
      : documentsOffTheLoopback(String(address), Object.assign({}, init));
}

describe('a key file whose authorization server answers what cannot be used', () => {
  it('is a conflict where its metadata names another issuer, and unavailable where its token endpoint answers no code, keeping nothing', async () => {
    const elsewhere = accountAt(undefined, 'https://elsewhere.example.com');
    const answeringNoCode = accountAt();
    const conflicting = harnessOf(elsewhere);
    const unanswered = harnessOf(answeringNoCode, { fetch: tokensAnsweredWith(400) });
    const first = await added(conflicting, asTheServiceAccount);
    const second = await added(unanswered, asTheServiceAccount);

    expect(
      await Promise.all([
        giving(conflicting, { id: first.id, token: first.token, key_file: elsewhere.keyFile }),
        giving(unanswered, { id: second.id, token: second.token, key_file: answeringNoCode.keyFile }),
      ]),
    ).toMatchObject([{ reason: 'conflict' }, { reason: 'unavailable' }]);
    expect([conflicting.secrets.values().size, unanswered.secrets.values().size]).toEqual([0, 0]);
  });
});

describe('a key file kept for a connection that changed meanwhile, or given where it does not belong', () => {
  it('forgets the key it kept when the connection changed before it was recorded', async () => {
    const account = accountAt();
    const removal: { run: () => Promise<unknown> } = { run: () => Promise.resolve() };
    const h = harnessOf(account, { beforeKeeping: () => removal.run() });
    const { id, token } = await added(h, asTheServiceAccount);
    removal.run = () => h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(await giving(h, { id, token, key_file: account.keyFile })).toMatchObject({ reason: 'not_found' });
    expect(h.secrets.values().size).toBe(0);
  });

  it('is refused beside any other member of a credential, and for a connection of another kind', async () => {
    const account = accountAt();
    const h = harnessOf(account);
    const signing = await added(h, asTheServiceAccount);
    const keyed = await added(h, crm);

    expect(
      await Promise.all([
        giving(h, { id: signing.id, token: signing.token, key_file: account.keyFile, value: 'crm-0f3c' }),
        giving(h, { id: keyed.id, token: keyed.token, key_file: account.keyFile }),
      ]),
    ).toMatchObject([
      { reason: 'invalid_input', issues: [{ pointer: '', detail: anyWords }] },
      { reason: 'invalid_input', issues: [{ pointer: '/key_file', detail: anyWords }] },
    ]);
    expect(h.secrets.values().size).toBe(0);
  });
});

describe('a provider whose way takes a key file, named in the settings file', () => {
  it('is refused at the credential, since a person gives the key file on Studio’s page alone', () => {
    const { providers } = accountAt();
    const named = { provider: 'mail', org: 'acme' };
    const placesOf = (entry: unknown) =>
      Effect.runSync(
        Effect.flip(
          readToolServerSettings(
            { TOOL_SERVERS: JSON.stringify({ named: entry }) },
            { modelProviders: ['openai'], providers: makeProviderResolver(providers) },
          ),
        ),
      ).problems.map(({ pointer }) => pointer);

    expect([
      placesOf(named),
      placesOf({ ...named, placeholders: { inbox }, credential: { kind: 'jwt_bearer' } }),
    ]).toEqual([['/named/credential'], ['/named/credential/kind']]);
  });
});
