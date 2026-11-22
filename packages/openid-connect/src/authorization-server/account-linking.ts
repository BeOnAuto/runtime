import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { KoaContextWithOIDC, Provider } from 'oidc-provider';

import { redirectedTo, shown, signInCookieAttributes } from './answering.ts';
import type { AccountLinking, LinkShown, PageShown, SignInPages } from './interaction-pages.ts';
import {
  abortedStep,
  accountLinkPath,
  authorizationServerRoutes,
  confirmedStep,
  interactionAddressOf,
  linkValueIn,
} from './paths.ts';

export const linkingClientId = 'account-linking';

const linkCookie = '__Host-Http-account-link';

const randomBytesOfAValue = 32;

const unreferred = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } as const;

const thePersonDeclined = 'access_denied';

type AuthorizationCode = InstanceType<Provider['AuthorizationCode']>;

type Grant = InstanceType<Provider['Grant']>;

export interface LinkingModels {
  readonly codeFound: (value: string) => Promise<AuthorizationCode | undefined>;
  readonly grantFound: (grantId: string) => Promise<Grant | undefined>;
}

export interface LinksServed {
  readonly issuer: string;
  readonly linking: AccountLinking;
  readonly models: LinkingModels;
  readonly pages: SignInPages;
}

interface Carried {
  readonly value: string;
  readonly state: string;
  readonly verifier: string;
}

interface AskedToAllow {
  readonly uid: string;
  readonly state: unknown;
}

function redirectUriOf(issuer: string): string {
  return `${issuer}${accountLinkPath}`;
}

export function linkingClientOf(issuer: string) {
  return {
    client_id: linkingClientId,
    redirect_uris: [redirectUriOf(issuer)],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
  } as const;
}

export function isLinking(params: Readonly<Record<string, unknown>>): boolean {
  return params['client_id'] === linkingClientId;
}

function aRandomValue(): string {
  return randomBytes(randomBytesOfAValue).toString('base64url');
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const aCarriedLink = /^(?<value>[\w-]+)\.(?<state>[\w-]+)\.(?<verifier>[\w-]+)$/u;

function carriedIn(ctx: KoaContextWithOIDC): Carried | undefined {
  const carried = aCarriedLink.exec(String(ctx.cookies.get(linkCookie)))?.groups;
  return carried === undefined
    ? undefined
    : { value: String(carried['value']), state: String(carried['state']), verifier: String(carried['verifier']) };
}

function isTheSame(given: unknown, kept: string): boolean {
  const asked = Buffer.from(typeof given === 'string' ? given : '');
  const expected = Buffer.from(kept);
  return asked.length === expected.length && timingSafeEqual(asked, expected);
}

function authorizationAskedOf(issuer: string, { state, verifier }: Carried): string {
  const asked = new URLSearchParams({
    client_id: linkingClientId,
    redirect_uri: redirectUriOf(issuer),
    response_type: 'code',
    scope: 'openid',
    state,
    code_challenge: challengeOf(verifier),
    code_challenge_method: 'S256',
  });
  return `${authorizationServerRoutes.authorization}?${asked.toString()}`;
}

const ended: LinkShown = { ended: true };

async function shownUnreferred(ctx: KoaContextWithOIDC, pages: SignInPages, page: PageShown): Promise<void> {
  await shown(ctx, pages, page);
  ctx.set(unreferred);
}

async function linkOpened(ctx: KoaContextWithOIDC, served: LinksServed, value: string): Promise<void> {
  if (!(await served.linking.opened(value))) {
    await shownUnreferred(ctx, served.pages, { link: ended });
    return;
  }
  const carried = { value, state: aRandomValue(), verifier: aRandomValue() };
  ctx.cookies.set(linkCookie, `${value}.${carried.state}.${carried.verifier}`, signInCookieAttributes);
  ctx.set(unreferred);
  redirectedTo(ctx, authorizationAskedOf(served.issuer, carried));
}

export async function linkAllowAsked(
  ctx: KoaContextWithOIDC,
  served: LinksServed,
  { uid, state }: AskedToAllow,
): Promise<void> {
  const carried = carriedIn(ctx);
  const page =
    carried === undefined || !isTheSame(state, carried.state)
      ? ended
      : await served.linking.allowShown(carried.value, {
          allowAt: interactionAddressOf(uid, confirmedStep),
          denyAt: interactionAddressOf(uid, abortedStep),
          tryAgainAt: interactionAddressOf(uid),
        });
  await shown(ctx, served.pages, { link: page });
}

interface CodeSaid {
  readonly clientId?: string | undefined;
  readonly redirectUri?: string | undefined;
  readonly codeChallengeMethod?: string | undefined;
  readonly codeChallenge?: string | undefined;
}

function isTheLinkingClients(said: CodeSaid, issuer: string, verifier: string): boolean {
  return (
    said.clientId === linkingClientId &&
    said.redirectUri === redirectUriOf(issuer) &&
    said.codeChallengeMethod === 'S256' &&
    said.codeChallenge === challengeOf(verifier)
  );
}

async function personOfTheCode(
  { issuer, models }: LinksServed,
  given: unknown,
  { verifier }: Carried,
): Promise<string | undefined> {
  const code = typeof given === 'string' && given !== '' ? await models.codeFound(given) : undefined;
  if (code === undefined || !code.isValid || !isTheLinkingClients(code, issuer, verifier)) {
    return undefined;
  }
  await code.consume();
  const grant = await models.grantFound(String(code.grantId));
  await grant?.destroy();
  return code.accountId;
}

async function linkDecided(ctx: KoaContextWithOIDC, served: LinksServed, carried: Carried): Promise<PageShown> {
  const { error, code } = ctx.query;
  if (error !== undefined) {
    return error === thePersonDeclined
      ? { link: await served.linking.denied(carried.value) }
      : { refused: 'not_signed_in', tryAgainAt: undefined };
  }
  const person = await personOfTheCode(served, code, carried);
  return person === undefined
    ? { refused: 'not_signed_in', tryAgainAt: undefined }
    : { link: await served.linking.allowed(carried.value, person) };
}

async function linkReturned(ctx: KoaContextWithOIDC, served: LinksServed): Promise<void> {
  const carried = carriedIn(ctx);
  ctx.cookies.set(linkCookie, null, signInCookieAttributes);
  const page =
    carried === undefined || !isTheSame(ctx.query['state'], carried.state)
      ? { link: ended }
      : await linkDecided(ctx, served, carried);
  await shownUnreferred(ctx, served.pages, page);
}

export function linkAnswered(ctx: KoaContextWithOIDC, served: LinksServed): Promise<void> | undefined {
  if (ctx.method !== 'GET') {
    return undefined;
  }
  if (ctx.path === accountLinkPath) {
    return linkReturned(ctx, served);
  }
  const value = linkValueIn(ctx.path);
  return value === undefined ? undefined : linkOpened(ctx, served, value);
}
