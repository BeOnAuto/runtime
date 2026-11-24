import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  additionOfProvider,
  hostAlternativesOf,
  takesTheValuesGiven,
  wayTakenWhereNoneIsNamed,
  type CredentialWay,
  type GivenToProvider,
  type ProviderEntry,
} from '../index.ts';
import { ledgers, providerOf, tracker } from '../testing/fixture-providers.ts';
import {
  asAManagedServiceAccount,
  asAnInstalledApp,
  asAnInstallingApp,
  asAServiceAccount,
  asTheCompanysApp,
  asTheCompanysServiceAccount,
  asTheServiceAccountItself,
  mail,
  signingInToMail,
} from '../testing/own-app-providers.ts';

const anyWords: unknown = expect.any(String);

const theCompanysValues = { tenant: '0a1b2c3d', mailbox: 'robot@acme.example.com' };

function added(given: GivenToProvider) {
  return Result.getOrThrow(additionOfProvider(mail, given));
}

function refused(given: GivenToProvider) {
  return Result.getOrThrow(Result.flip(additionOfProvider(mail, given)));
}

describe('a way that asks values of its own', () => {
  it('is added with them in its issuer and its base_url, which takes the place of the provider’s', () => {
    expect(added({ kind: 'client_credentials', placeholders: theCompanysValues })).toMatchObject({
      entry: { base_url: 'https://api.mail.example.com/v1/mailboxes/robot@acme.example.com' },
      credential: { kind: 'client_credentials', issuer: 'https://login.mail.example.com/0a1b2c3d' },
      placeholders: theCompanysValues,
      permissions: 'application',
    });
  });

  it('leaves another way of the provider as it was, asking none of them', () => {
    expect(added({})).toMatchObject({
      entry: { base_url: 'https://api.mail.example.com/v1/self' },
      credential: { kind: 'authorization', issuer: 'https://login.mail.example.com/common' },
      placeholders: {},
    });
  });

  it('carries them in the parameters of its token request, where another way of the provider carries none', () => {
    const ofTheAccount = { grant_type: 'account_credentials', account_id: '{tenant}' };
    const provider = providerOf({
      ...mail,
      credentials: [signingInToMail, { ...asTheCompanysApp, parameters: ofTheAccount }],
    });
    const madeBy = (given: GivenToProvider) => Result.getOrThrow(additionOfProvider(provider.entry, given)).credential;

    expect(madeBy({ kind: 'client_credentials', placeholders: theCompanysValues }).parameters).toEqual({
      grant_type: 'account_credentials',
      account_id: '0a1b2c3d',
    });
    expect(madeBy({})).not.toHaveProperty('parameters');
  });

  it('reaches the hosts of its own base_url and issuer, where another way reaches the provider’s', () => {
    const mailboxHost = { description: 'The host of the mailbox', pattern: '^[a-z]{1,8}$', example: 'eu' };
    const elsewhere = {
      ...asTheCompanysApp,
      base_url: 'https://{mailbox_host}/v1/mailboxes/{mailbox}',
      placeholders: { ...asTheCompanysApp.placeholders, mailbox_host: mailboxHost },
    };
    const provider = providerOf({ ...mail, credentials: [signingInToMail, elsewhere] });

    expect(provider.entry.credentials.map((way) => hostAlternativesOf(provider, way))).toEqual([
      [['api.mail.example.com', 'login.mail.example.com']],
      [['{mailbox_host}', 'login.mail.example.com']],
    ]);
  });
});

const asTheApp = { kind: 'client_credentials' } as const;

const refusals: readonly (readonly [string, GivenToProvider, readonly string[]])[] = [
  ['a value it asks is left out', { ...asTheApp, placeholders: { tenant: '0a1b2c3d' } }, ['/placeholders/mailbox']],
  ['its value is given for another way', { placeholders: { tenant: '0a1b2c3d' } }, ['/placeholders/tenant']],
  [
    'a value misses its pattern',
    { ...asTheApp, placeholders: { ...theCompanysValues, tenant: '0A1B2C3D' } },
    ['/placeholders/tenant'],
  ],
  [
    'a value would move the address',
    { ...asTheApp, placeholders: { ...theCompanysValues, mailbox: 'robot@acme.example.com/../x' } },
    ['/placeholders/mailbox'],
  ],
  [
    'the provider takes no way of the kind asked',
    { kind: 'secret', placeholders: theCompanysValues },
    ['/placeholders/tenant', '/placeholders/mailbox', '/credential/kind'],
  ],
];

describe('the values of a way that asks values of its own', () => {
  it.each(refusals)('are refused where %s', (_case, given, pointers) => {
    expect(refused(given)).toEqual(pointers.map((pointer) => ({ pointer, detail: anyWords })));
  });
});

function wayAt(entry: ProviderEntry, index: number): CredentialWay {
  const way = entry.credentials[index];
  if (way === undefined) {
    throw new Error(`The entry ${entry.name} has no way ${String(index)}`);
  }
  return way;
}

const aSignIn = wayAt(mail, 0);

const theApp = wayAt(mail, 1);

const exchanging = providerOf({ ...mail, credentials: [asTheCompanysServiceAccount, asAManagedServiceAccount] }).entry;

const theCompanysAccount = wayAt(exchanging, 0);

const aManagedAccount = wayAt(exchanging, 1);

const ownValuesOfMail = { project: '123456789012', account: 'robot@acme.example.com' };

const waysAsked = {
  'a sign-in': [mail, aSignIn],
  'an app': [mail, theApp],
  'a client of a provider whose manager is optional': [ledgers, wayAt(ledgers, 0)],
  'a key of a provider that asks a site': [tracker, wayAt(tracker, 0)],
  "the company's own service account": [exchanging, theCompanysAccount],
  'a service account Auto creates': [exchanging, aManagedAccount],
} as const;

describe('whether an addition through a way takes the values given', () => {
  it.each([
    ['a sign-in', {}, true],
    ['a sign-in', { tenant: '0a1b2c3d' }, false],
    ['an app', { ...theCompanysValues }, true],
    ['an app', { tenant: '0a1b2c3d' }, false],
    ['an app', { ...theCompanysValues, region: 'eu' }, false],
    ['a client of a provider whose manager is optional', { tenant: 'acme' }, true],
    ['a key of a provider that asks a site', {}, false],
    ["the company's own service account", {}, true],
    ["the company's own service account", { project: ownValuesOfMail.project }, false],
    ["the company's own service account", { ...ownValuesOfMail }, true],
    ['a service account Auto creates', {}, true],
    ['a service account Auto creates', { ...ownValuesOfMail }, false],
  ] as const)('is answered for %s given %o as %s', (named, given, takes) => {
    const [entry, way] = waysAsked[named];

    expect(takesTheValuesGiven(entry, way, given)).toBe(takes);
  });
});

const everyWay: readonly CredentialWay[] = [aSignIn, theCompanysAccount, aManagedAccount];

describe('the way an addition that names no way takes, of the ways offered that take the values given', () => {
  it.each([
    ['Auto’s service account, where it is offered', everyWay, {}, aManagedAccount],
    ['the company’s own, where Auto’s is not offered', [aSignIn, theCompanysAccount], {}, theCompanysAccount],
    ['the company’s own, given all of its values', everyWay, { ...ownValuesOfMail }, theCompanysAccount],
    ['none, given some of the company’s own values', everyWay, { project: ownValuesOfMail.project }, undefined],
    ['a sign-in, where no way that exchanges a token is offered', [aSignIn], {}, aSignIn],
  ] as const)('is %s', (_named, offered, given, taken) => {
    const takes = offered.filter((way) => takesTheValuesGiven(exchanging, way, given));

    expect(wayTakenWhereNoneIsNamed(takes)?.way).toBe(taken);
  });
});

describe('an addition that names its way', () => {
  it.each([
    ['a sign-in', {}],
    ['an app', { ...theCompanysValues }],
    ["the company's own service account", {}],
    ["the company's own service account", { project: ownValuesOfMail.project }],
    ["the company's own service account", { ...ownValuesOfMail }],
    ['a service account Auto creates', {}],
    ['a service account Auto creates', { ...ownValuesOfMail }],
  ] as const)('through %s given %o is taken where one that names no way takes it', (named, given) => {
    const [entry, way] = waysAsked[named];
    const naming = additionOfProvider({ ...entry, credentials: [way] }, { kind: way.kind, placeholders: given });

    expect(Result.isSuccess(naming)).toBe(takesTheValuesGiven(entry, way, given));
  });
});

describe('a way that signs an assertion for an account', () => {
  it('is added with its subject resolved from the value given for it, acting as the app', () => {
    const provider = providerOf({ ...mail, credentials: [signingInToMail, asAServiceAccount] });

    expect(
      Result.getOrThrow(
        additionOfProvider(provider.entry, { kind: 'jwt_bearer', placeholders: { inbox: 'inbox@acme.example.com' } }),
      ),
    ).toMatchObject({
      credential: {
        kind: 'jwt_bearer',
        issuer: 'https://login.mail.example.com',
        scope: 'mail.read',
        subject: 'inbox@acme.example.com',
      },
      placeholders: { inbox: 'inbox@acme.example.com' },
      permissions: 'application',
      account_types: [],
    });
  });
});

describe('a way that signs an assertion for the service account itself', () => {
  it('is added with no subject and no value, acting as the app', () => {
    const provider = providerOf({ ...mail, credentials: [signingInToMail, asTheServiceAccountItself] });
    const addition = Result.getOrThrow(additionOfProvider(provider.entry, { kind: 'jwt_bearer' }));

    expect(addition).toMatchObject({
      credential: { kind: 'jwt_bearer', issuer: 'https://login.mail.example.com', scope: 'mail.read' },
      placeholders: {},
      permissions: 'application',
      account_types: [],
    });
    expect(addition.credential).not.toHaveProperty('subject');
  });
});

describe('a way that signs an assertion with a key file in PEM, asking a token through a request of its own', () => {
  const provider = providerOf({ ...mail, credentials: [signingInToMail, asAnInstalledApp] });
  const addedAs = (placeholders: Readonly<Record<string, string>>) =>
    additionOfProvider(provider.entry, { kind: 'jwt_bearer', placeholders });

  it('is added with the client and the address of its token request resolved from the values given for them, acting as the app', () => {
    expect(Result.getOrThrow(addedAs({ app: '1234567', installation: '12345678' }))).toMatchObject({
      credential: {
        kind: 'jwt_bearer',
        issuer: 'https://api.mail.example.com/apps',
        client_id: '1234567',
        token_request: {
          method: 'POST',
          url: 'https://api.mail.example.com/apps/installations/12345678/tokens',
          issued: { access_token: '/token', expires_at: '/expires_at' },
        },
      },
      permissions: 'application',
      account_types: [],
    });
  });

  it('is refused a value that misses its pattern, so none moves the address its token request goes to', () => {
    expect(Result.getOrThrow(Result.flip(addedAs({ app: '1234567', installation: '../../user' })))).toEqual([
      { pointer: '/placeholders/installation', detail: anyWords },
    ]);
  });
});

describe('a way that connects by installing the application whoever runs Auto registered', () => {
  it('is added with its installation as the entry writes it, which the consent fills, acting as the app', () => {
    const provider = providerOf({ ...mail, credentials: [signingInToMail, asAnInstallingApp] });
    const addition = Result.getOrThrow(
      additionOfProvider(provider.entry, {
        kind: 'authorization',
        canBeGiven: (way) => way.installation !== undefined,
      }),
    );

    expect(addition).toMatchObject({
      credential: { kind: 'authorization', clients: ['registered'], installation: asAnInstallingApp.installation },
      placeholders: {},
      permissions: 'application',
      account_types: [],
    });
  });
});
