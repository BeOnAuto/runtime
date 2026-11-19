import { createHash, randomBytes } from 'node:crypto';

import { afterAll } from 'vitest';

import type { SignInOutcome } from '../authorization-server/interaction-pages.ts';
import {
  browserAt,
  issuer,
  servedOverHttp,
  signingIn,
  signInCallbackPath,
  studioOrigin,
  type Asking,
  type Browser,
  type ServedOverHttp,
  type ServedWith,
} from './authorization-server-over-http.ts';

export const agentRedirect = 'http://127.0.0.1:7777/callback';

export const studioClient = `${studioOrigin}/.well-known/oauth-client-metadata`;

export const studioRedirect = `${studioOrigin}/oauth/callback`;

const verifier = randomBytes(32).toString('base64url');

const challenge = createHash('sha256').update(verifier).digest('base64url');

export type Fields = Readonly<Record<string, unknown>>;

export async function fieldsOf(answer: Readonly<Response>): Promise<Fields> {
  const body: unknown = await answer.json();
  return Object.fromEntries(Object.entries(new Object(body)));
}

export function locationOf(answer: Readonly<Response>): string {
  return String(answer.headers.get('location'));
}

export function formOf(fields: Readonly<Record<string, string>>): Asking {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}

const anAgentsName = { client_name: 'An agent' };

export async function registered(
  browser: Browser,
  named: Readonly<Record<string, string>> = anAgentsName,
): Promise<string> {
  const answer = await browser.at('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [agentRedirect], token_endpoint_auth_method: 'none', ...named }),
  });
  return String((await fieldsOf(answer))['client_id']);
}

export interface Asked {
  readonly clientId: string;
  readonly redirectUri?: string;
  readonly scope?: string;
  readonly resource?: string;
  readonly prompt?: string;
}

export function authorizationAskedBy({
  clientId,
  redirectUri = agentRedirect,
  scope = 'org:read',
  resource = issuer,
  prompt,
}: Asked): string {
  const asked = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'agent-state',
    scope,
    ...(resource === '' ? {} : { resource }),
    ...(prompt === undefined ? {} : { prompt }),
  });
  return `/oauth/authorize?${asked.toString()}`;
}

export async function signInBegun(browser: Browser, asked: Asked): Promise<Response> {
  return browser.at(locationOf(await browser.at(authorizationAskedBy(asked))));
}

export async function backFromTheSignIn(browser: Browser, toTheSignIn: Readonly<Response>): Promise<Response> {
  const upstreamState = new URL(locationOf(toTheSignIn)).searchParams.get('state');
  const called = await browser.at(`${signInCallbackPath}?code=upstream-code&state=${String(upstreamState)}`);
  return browser.at(locationOf(called));
}

export async function signedInAs(browser: Browser, asked: Asked): Promise<Response> {
  return browser.at(locationOf(await backFromTheSignIn(browser, await signInBegun(browser, asked))));
}

export function codeIn(answer: Readonly<Response>): string {
  return String(new URL(locationOf(answer)).searchParams.get('code'));
}

export async function allowed(browser: Browser, consent: string): Promise<string> {
  await browser.at(consent);
  const decided = await browser.at(`${consent}/confirm`, { method: 'POST', headers: { origin: issuer } });
  return codeIn(await browser.at(locationOf(decided)));
}

export async function exchanged(browser: Browser, code: string, asked: Asked): Promise<Fields> {
  const { clientId, redirectUri = agentRedirect, resource = issuer } = asked;
  const fields = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri };
  return fieldsOf(
    await browser.at(
      '/oauth/token',
      formOf({ ...fields, client_id: clientId, ...(resource === '' ? {} : { resource }) }),
    ),
  );
}

export function refreshed(browser: Browser, clientId: string, refreshToken: unknown): Promise<Response> {
  return browser.at(
    '/oauth/token',
    formOf({ grant_type: 'refresh_token', refresh_token: String(refreshToken), client_id: clientId }),
  );
}

export function serversClosedAfterAll(): (choices?: ServedWith) => Promise<ServedOverHttp> {
  const served: ServedOverHttp[] = [];
  afterAll(async () => {
    await Promise.all(served.map((server) => server.close()));
  });
  return async (choices = {}) => {
    const server = await servedOverHttp(choices);
    served.push(server);
    return server;
  };
}

export interface Connected {
  readonly server: ServedOverHttp;
  readonly browser: Browser;
  readonly clientId: string;
  readonly code: string;
  readonly tokens: Fields;
}

export async function connectedAt(server: ServedOverHttp): Promise<Connected> {
  const browser = browserAt(server.at);
  const clientId = await registered(browser);
  const code = await allowed(browser, locationOf(await signedInAs(browser, { clientId })));
  return { server, browser, clientId, code, tokens: await exchanged(browser, code, { clientId }) };
}

export function signInEndingIn(outcome: SignInOutcome): ServedWith {
  return { signIn: { ...signingIn, finished: () => Promise.resolve(outcome) } };
}

export function hiddenFieldsIn(page: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...page.matchAll(/name="(\w+)" value="([^"]*)"/gu)].map(([, name = '', value = '']: readonly string[]) => [
      name,
      value,
    ]),
  );
}

export const pastTheEndOfARequestMs = 61 * 60_000;
