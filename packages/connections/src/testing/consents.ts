import type { Outcome } from '@on.auto/operations';
import { audiences, providerListOf, providerOf } from '@on.auto/providers/testing';
import { servedForConsent, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { consentedAt, registeredAt, type ClientRegistration, type Consented } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';

import { reconnected, type Added } from './additions.ts';
import { ada, harness, operationNamed, type Harness, type HarnessOptions, loopbackPolicy } from './harness.ts';

export const studioReturn = 'https://studio.on.auto/connect-return';

export interface ConsentAt {
  readonly url: string;
  readonly expiresAt: string;
}

const StartedSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({ authorize: Schema.Struct({ url: Schema.String, expires_at: Schema.String }) }),
});

export function consentFake(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  return servedForConsent({ redirectUris: [studioReturn], ...changes });
}

export const orgsClientSecret = 'the-org-app-client-secret-91d0';

export const theOrgsOAuthClient = { client_id: 'org-app', client_secret: orgsClientSecret };

export const underTheOrgsOAuthClient = {
  provider: 'files',
  credential: { kind: 'authorization', oauth_client: 'own' },
};

export function orgsOAuthClientFake(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  return consentFake({ clientId: theOrgsOAuthClient.client_id, clientSecret: orgsClientSecret, ...changes });
}

export function givingTheClient(
  h: Harness,
  { id, token }: Pick<Added, 'id' | 'token'>,
  given: Readonly<Record<string, string>> = theOrgsOAuthClient,
  caller = ada,
): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'give_client'), caller, { id, token, ...given });
}

export const filesWay = { scope: 'files.read', parameters: { access_type: 'offline' } };

const filesWords: Readonly<Record<string, string>> = {
  'files.read': 'Read the files of the account.',
  'files.write': 'Create and change the files of the account.',
  'files.list': 'See the names of the files of the account.',
};

function saidFor(way: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const asked = new Set(String(way['scope']).split(' '));
  return Object.fromEntries(Object.entries(filesWords).filter(([name]: readonly [string, string]) => asked.has(name)));
}

export function filesAt(fake: FakeMcpServer, way: Readonly<Record<string, unknown>> = filesWay) {
  return providerOf({
    name: 'files',
    title: 'Files',
    description: 'Read the files of an account.',
    website: 'https://developer.files.example.com',
    type: 'mcp',
    url: fake.url,
    credentials: [{ kind: 'authorization', issuer: fake.origin, says: saidFor(way), ...way }],
  });
}

export interface ConsentHarnessOptions extends HarnessOptions {
  readonly way?: Readonly<Record<string, unknown>>;
}

export function consentHarnessAt(fake: FakeMcpServer, { way, ...options }: ConsentHarnessOptions = {}): Harness {
  return harness({
    providers: providerListOf(filesAt(fake, way)),
    consenting: { registeredClients: [registeredAt(fake.origin)] },
    mostSecretCharacters: 4096,
    policy: loopbackPolicy,
    ...options,
  });
}

export function starting(h: Harness, { id, token }: Added, at?: string): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'start'), ada, { id, token }, at);
}

export async function startedAt(h: Harness, link: Added, at?: string): Promise<ConsentAt> {
  const { output } = Schema.decodeUnknownSync(StartedSchema)(await starting(h, link, at));
  return { url: output.authorize.url, expiresAt: output.authorize.expires_at };
}

export function finishing(
  h: Harness,
  { id, token }: Added,
  { code, state, iss }: Consented,
  at?: string,
): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'finish'), ada, { id, token, code, state, iss }, at);
}

export async function reconnectionStartedAt(h: Harness, id: string, at?: string): Promise<ConsentAt> {
  return startedAt(h, await reconnected(h, id, at), at);
}

export async function consentedOf(h: Harness, link: Added, at?: string): Promise<Consented> {
  return consentedAt((await startedAt(h, link, at)).url);
}

export async function connectedThrough(h: Harness, link: Added, at?: string): Promise<Outcome> {
  return finishing(h, link, await consentedOf(h, link, at), at);
}

export async function scopeAskedAt(h: Harness, link: Added, at?: string): Promise<string | null> {
  return new URL((await startedAt(h, link, at)).url).searchParams.get('scope');
}

export const sharing = {
  name: 'share',
  for: 'Share your files with other people.',
  scope: 'files.share',
  says: { 'files.share': 'Share the files of the account with other people.' },
};

export const sharingWay = { ...filesWay, more: [sharing] };

export function filesApiAt(fake: FakeMcpServer) {
  return providerOf({
    name: 'files-api',
    title: 'Files',
    description: 'Read the files of an account over its HTTP API.',
    website: 'https://developer.files.example.com',
    type: 'openapi',
    document: `${fake.origin}/openapi.json`,
    base_url: `${fake.origin}/v1`,
    credentials: [
      {
        kind: 'authorization',
        issuer: fake.origin,
        authorization_endpoint: `${fake.origin}/authorize`,
        token_endpoint: `${fake.origin}/token`,
        revocation_endpoint: `${fake.origin}/revoke`,
      },
    ],
  });
}

export function audiencesAt(fake: FakeMcpServer) {
  const [way] = audiences.credentials;
  return providerOf({
    ...audiences,
    document: `${fake.origin}/openapi.json`,
    base_url: `${fake.origin}/v1`,
    credentials: [{ ...way, issuer: fake.origin }],
  });
}
