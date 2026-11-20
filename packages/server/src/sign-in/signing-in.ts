import { createHash, randomBytes } from 'node:crypto';

import { defaultStudioOrigin, studioClientOf } from '@on.auto/identity';
import { browserAt, type Asking, type Browser, type FakeProviderOptions } from '@on.auto/openid-connect/testing';
import { onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { fieldOfEachFactIn, rowsOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { providerOverHttps } from './issuer-over-https.ts';

export const subject = 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4';

export const publicUrl = 'https://auto.example.test';

const agentRedirect = 'http://127.0.0.1:7777/callback';

export const studio = studioClientOf(defaultStudioOrigin);

const verifier = randomBytes(32).toString('base64url');

const challenge = createHash('sha256').update(verifier).digest('base64url');

type FakeProvider = Awaited<ReturnType<typeof providerOverHttps>>;

export interface SigningIn {
  readonly provider: FakeProvider;
  readonly environment: Environment;
  readonly at: (path: string, init?: Asking) => Promise<Response>;
  readonly aBrowser: () => Browser;
  readonly peopleKept: () => Promise<readonly unknown[]>;
  readonly factsKept: (type: string, field: string) => Promise<readonly unknown[]>;
}

type Environment = Readonly<Record<string, string>>;

export interface SigningInAs {
  readonly provider?: FakeProviderOptions;
  readonly settings?: Environment;
  readonly registersItself?: boolean;
  readonly byDefault?: boolean;
}

function environmentOf(provider: FakeProvider, port: number, registersItself: boolean): Environment {
  const client = registersItself
    ? {}
    : { OIDC_CLIENT_ID: provider.clientId, OIDC_CLIENT_SECRET: provider.clientSecret };
  return { HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: publicUrl, OIDC_ISSUER: provider.issuer, ...client };
}

export const claimOfTheDefault = 'tenant';

function optionsOf(provider: FakeProvider, byDefault: boolean): typeof compositionRoot {
  return byDefault
    ? {
        ...compositionRoot,
        defaultIdentityProvider: {
          issuer: provider.issuer,
          scopes: ['openid', 'profile', 'email'],
          requiredClaim: { claim: claimOfTheDefault },
        },
      }
    : compositionRoot;
}

function byDefaultIn(environment: Environment, byDefault: boolean): Environment {
  const { OIDC_ISSUER: _issuer, OIDC_CLIENT_ID: _id, OIDC_CLIENT_SECRET: _secret, ...withoutAnyProvider } = environment;
  return byDefault ? withoutAnyProvider : environment;
}

type RunningServer = Awaited<ReturnType<typeof startServer>>;

export interface Running extends SigningIn {
  readonly server: () => RunningServer;
  readonly restarted: () => Promise<RunningServer>;
}

export async function signingIn({
  provider: options = {},
  settings = {},
  registersItself = false,
  byDefault = false,
}: SigningInAs = {}): Promise<Running> {
  const provider = await providerOverHttps('/tenant/v2.0', options);
  const port = await aPortNothingListensOn();
  const ledger = temporaryLedger();
  const given = byDefaultIn(environmentOf(provider, port, registersItself), byDefault);
  const environment = { ...given, ...settings, LEDGER_FILE: ledger.fileName };
  const serverOptions = optionsOf(provider, byDefault);
  const running = { server: await startServer(environment, serverOptions) };
  onTestFinished(async () => {
    await running.server.stop();
    ledger.remove();
  });
  const local = `http://127.0.0.1:${String(port)}`;
  return {
    provider,
    environment,
    at: (path, init = {}) => browserAt(local, publicUrl).at(path, init),
    aBrowser: () => browserAt(local, publicUrl),
    peopleKept: () => rowsOfTheLedgerIn(ledger.fileName, 'auth_people'),
    factsKept: (type, field) => fieldOfEachFactIn(ledger.fileName, type, field),
    server: () => running.server,
    restarted: async () => {
      await running.server.stop();
      running.server = await startServer(environment, serverOptions);
      return running.server;
    },
  };
}

export async function startOf(options: FakeProviderOptions, registersItself: boolean): Promise<unknown> {
  const provider = await providerOverHttps('/tenant/v2.0', options);
  const port = await aPortNothingListensOn();
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  const environment = { ...environmentOf(provider, port, registersItself), LEDGER_FILE: ledger.fileName };
  return startServer(environment, compositionRoot).catch((failure: unknown) => failure);
}

export function locationOf(answer: Readonly<Response>): string {
  return String(answer.headers.get('location'));
}

export async function fieldsOf(answer: Readonly<Response>): Promise<Readonly<Record<string, unknown>>> {
  const body: unknown = await answer.json();
  return Object.fromEntries(Object.entries(new Object(body)));
}

function formOf(fields: Readonly<Record<string, string>>): Asking {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}

export async function registered(browser: Browser): Promise<string> {
  const answer = await browser.at('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [agentRedirect],
      client_name: 'An agent',
      token_endpoint_auth_method: 'none',
    }),
  });
  return String((await fieldsOf(answer))['client_id']);
}

export interface Asked {
  readonly clientId: string;
  readonly redirectUri?: string;
  readonly scope?: string;
  readonly prompt?: string;
}

export function authorizationAskedBy({
  clientId,
  redirectUri = agentRedirect,
  scope = 'org:read org:write',
  prompt,
}: Asked): string {
  const asked = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'client-state',
    scope,
    resource: publicUrl,
    ...(prompt === undefined ? {} : { prompt }),
  });
  return `/oauth/authorize?${asked.toString()}`;
}

export async function toTheProvider(browser: Browser, asked: Asked): Promise<string> {
  return locationOf(await browser.at(locationOf(await browser.at(authorizationAskedBy(asked)))));
}

export async function backFrom(browser: Browser, query: string): Promise<Response> {
  return browser.at(locationOf(await browser.at(`/auth/oidc/callback?${query}`)));
}

export async function signedInAs(
  { provider }: Pick<SigningIn, 'provider'>,
  browser: Browser,
  asked: Asked,
  who: string,
): Promise<Response> {
  const upstream = await toTheProvider(browser, asked);
  return browser.at(locationOf(await backFrom(browser, provider.signedIn(upstream, who))));
}

export async function allowed(browser: Browser, consent: string): Promise<string> {
  const decided = await browser.at(`${consent}/confirm`, { method: 'POST', headers: { origin: publicUrl } });
  return new URL(locationOf(await browser.at(locationOf(decided)))).searchParams.getAll('code').join('');
}

export async function tokensExchanged(
  browser: Browser,
  code: string,
  asked: Asked,
): Promise<Readonly<Record<string, unknown>>> {
  const { clientId, redirectUri = agentRedirect } = asked;
  const answer = await browser.at(
    '/oauth/token',
    formOf({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
      resource: publicUrl,
    }),
  );
  return fieldsOf(answer);
}

export async function exchanged(browser: Browser, code: string, asked: Asked): Promise<string> {
  return String((await tokensExchanged(browser, code, asked))['access_token']);
}

export function refreshed(browser: Browser, clientId: string, refreshToken: unknown): Promise<Response> {
  return browser.at(
    '/oauth/token',
    formOf({ grant_type: 'refresh_token', refresh_token: String(refreshToken), client_id: clientId }),
  );
}

export function bearer(token: string): Asking {
  return { headers: { authorization: `Bearer ${token}` } };
}
