import { generateKeyPairSync } from 'node:crypto';

import type { Outcome } from '@on.auto/operations';
import { providerListOf, providerOf } from '@on.auto/providers/testing';
import { forConsentInProcess, registeredAt, type FakeAnswer, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Redacted, Schema } from 'effect';

import { added, crmKeyHelp, type Added } from './additions.ts';
import { consentedOf, studioReturn } from './consents.ts';
import { ada, harness, loopbackPolicy, operationNamed, type Harness, type HarnessOptions } from './harness.ts';

export const installPage = 'https://files.example.com/apps/auto/installations/new';

function onAnOrganization(id: number, name: string) {
  return { id, account: { id: id + 1000, name, kind: 'organization' } };
}

function onAPersonalAccount(id: number, name: string, account: number) {
  return { id, account: { id: account, name, kind: 'person' } };
}

const thePerson = 2001;

const reachable = [
  onAnOrganization(41, 'acme'),
  onAnOrganization(42, 'acme-labs'),
  { id: 43, account: {} },
  onAnOrganization(44, 'acme-research'),
  onAnOrganization(45, 'acme-ventures'),
  onAPersonalAccount(46, 'grace', 2002),
  onAPersonalAccount(47, 'ada', thePerson),
  onAnOrganization(48, 'acme-partners'),
  onAnOrganization(49, 'acme-archive'),
];

function membershipOf(role: string, state: string) {
  return { status: 200, body: { role, state, organization: {} } };
}

const notAMember = { status: 404, body: { message: 'Not Found' } };

export const answersToThePerson: Readonly<Record<string, FakeAnswer>> = {
  '/me': { status: 200, body: { id: thePerson, name: 'ada' } },
  '/memberships/acme': membershipOf('admin', 'active'),
  '/memberships/acme-labs': membershipOf('admin', 'active'),
  '/memberships/acme-research': membershipOf('member', 'active'),
  '/memberships/acme-ventures': membershipOf('admin', 'pending'),
  '/memberships/acme-partners': notAMember,
  '/memberships/acme-archive': { status: 200, body: { role: 'admin', organization: {} } },
};

export const listedToThePerson = [
  { id: '41', name: 'acme', admin: true },
  { id: '42', name: 'acme-labs', admin: true },
  { id: '44', name: 'acme-research', admin: false },
  { id: '45', name: 'acme-ventures', admin: false },
  { id: '46', name: 'grace', admin: false },
  { id: '47', name: 'ada', admin: true },
  { id: '48', name: 'acme-partners', admin: false },
  { id: '49', name: 'acme-archive', admin: false },
];

export const unadministered = [
  ['an organization the person is a member of, and no admin', '44'],
  ['an organization the person was invited to administer, and has not joined', '45'],
  ['another person’s personal account', '46'],
  ['an organization the service says the person is not a member of', '48'],
] as const;

export interface InstallingFake {
  readonly fake: FakeMcpServer;
  readonly privateKey: string;
}

export function installingFake(
  installations: readonly unknown[] | null = reachable,
  answers: Readonly<Record<string, FakeAnswer>> = answersToThePerson,
): InstallingFake {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const fake = forConsentInProcess({
    redirectUris: [studioReturn],
    publicKey,
    tokenRequestPath: '/app/installations/41/access_tokens',
    ...(installations === null ? {} : { installationsAt: { path: '/user/installations', installations } }),
    answersToItsTokens: answers,
  });
  return { fake, privateKey };
}

export const requestSent = { setup_action: 'request' };

function installingWayAt({ origin }: FakeMcpServer, requested: boolean, api: string) {
  return {
    kind: 'authorization',
    permissions: 'application',
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    clients: ['registered'],
    installation: {
      issuer: api,
      installations: {
        method: 'GET',
        url: `${api}/user/installations`,
        list: '/installations',
        id: '/id',
        name: '/account/name',
        account: '/account/id',
        personal: { '/account/kind': ['person'] },
      },
      userinfo: { method: 'GET', url: `${api}/me`, id: '/id' },
      membership: {
        method: 'GET',
        url: `${api}/memberships/{account_name}`,
        admin: { '/role': ['admin'], '/state': ['active'] },
      },
      returned: { installation: 'installation_id', ...(requested ? { requested: { setup_action: ['request'] } } : {}) },
      token_request: {
        method: 'POST',
        url: `${api}/app/installations/{installation_id}/access_tokens`,
        issued: { access_token: '/access_token' },
      },
    },
  };
}

export function registeredApplicationAt({ fake, privateKey }: InstallingFake) {
  return registeredAt(fake.origin, { application: { privateKey: Redacted.make(privateKey), installPage } });
}

const byAKey = { kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer', ...crmKeyHelp };

export interface InstallingHarnessOptions extends HarnessOptions {
  readonly requested?: boolean;
  readonly byAKeyToo?: boolean;
  readonly heldHere?: boolean;
  readonly registeredAsAnApplication?: boolean;
  readonly api?: string;
}

interface InstallingWays {
  readonly requested?: boolean;
  readonly api?: string;
  readonly byAKeyToo?: boolean | undefined;
}

export function installingProvidersAt(
  fake: FakeMcpServer,
  { requested = true, api = fake.origin, byAKeyToo = false }: InstallingWays = {},
) {
  return providerListOf(
    providerOf({
      name: 'files',
      title: 'Files',
      description: 'Read the files of an account.',
      website: 'https://developer.files.example.com',
      type: 'mcp',
      url: fake.url,
      credentials: [installingWayAt(fake, requested, api), ...(byAKeyToo ? [byAKey] : [])],
    }),
  );
}

export function installingHarnessAt(
  installing: InstallingFake,
  {
    requested = true,
    heldHere = true,
    registeredAsAnApplication = true,
    api,
    byAKeyToo,
    ...options
  }: InstallingHarnessOptions = {},
): Harness {
  const registered = registeredAsAnApplication
    ? registeredApplicationAt(installing)
    : registeredAt(installing.fake.origin);
  return harness({
    providers: installingProvidersAt(installing.fake, { requested, ...(api === undefined ? {} : { api }), byAKeyToo }),
    consenting: { registeredClients: [registered] },
    registeredClients: heldHere ? [registered] : [],
    mostSecretCharacters: 4096,
    policy: loopbackPolicy,
    ...options,
  });
}

export function finishingWith(h: Harness, { id, token }: Pick<Added, 'id' | 'token'>, given: object): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'finish'), ada, { id, token, ...given });
}

export function filesOf(h: Harness): Promise<Added> {
  return added(h, { provider: 'files' });
}

export async function typesOf(h: Harness): Promise<readonly string[]> {
  return (await h.facts()).map(({ type }) => type);
}

const answeredInstallationOf = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ installation: Schema.String }) }),
);

export async function signedInAgainFor(h: Harness, link: Added, returned: string): Promise<object> {
  const answered = await finishingWith(h, link, {
    ...(await consentedOf(h, link)),
    parameters: { installation_id: returned, setup_action: 'install' },
  });
  return { ...(await consentedOf(h, link)), installation: answeredInstallationOf(answered).output.installation };
}
