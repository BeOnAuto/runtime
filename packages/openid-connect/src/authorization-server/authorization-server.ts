import type { IncomingMessage, ServerResponse } from 'node:http';

import { Predicate } from 'effect';
import { errors, Provider, type Configuration, type ErrorOut, type KoaContextWithOIDC } from 'oidc-provider';

import { shown } from './answering.ts';
import {
  configurationOf,
  type AuthorizationServerSettings,
  type PersonClaims,
  type ServersPages,
} from './configuration.ts';
import type { AccountLinking, InteractionSignIn, SignInPages } from './interaction-pages.ts';
import { interactionsOf, notOpen, type InteractionModels } from './interactions.ts';
import { answeredPathsOf } from './paths.ts';
import type { ProviderRows } from './provider-rows.ts';
import type { SigningKey } from './signing-key.ts';

export type MiddlewareOutcome = { readonly answered: Response } | { readonly passed: Headers };

export type ApiMiddleware = (request: Readonly<Request>) => Promise<MiddlewareOutcome>;

export interface AuthorizationServerParts {
  readonly rows: ProviderRows;
  readonly signingKey: SigningKey;
  readonly claimsOf: (accountId: string) => Promise<PersonClaims | undefined>;
  readonly middleware: ApiMiddleware;
  readonly signIn: InteractionSignIn;
  readonly pages: SignInPages;
  readonly signInCallbackPath: string;
  readonly now?: () => number;
  readonly linking?: AccountLinking;
}

export interface IssuedAccessToken {
  readonly accountId: string;
  readonly clientId: string;
  readonly clientName: string | undefined;
  readonly scope: string;
  readonly isStudios: boolean;
}

export interface AuthorizationServer {
  readonly issuer: string;
  readonly answers: (path: string) => boolean;
  readonly listener: (request: IncomingMessage, response: ServerResponse) => void;
  readonly accessTokenOf: (value: string) => Promise<IssuedAccessToken | undefined>;
}

type Next = () => Promise<unknown>;

type NodeHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

type AccessToken = InstanceType<Provider['AccessToken']>;

interface ProviderModels extends InteractionModels {
  readonly accessTokenFound: (value: string) => Promise<AccessToken | undefined>;
}

const seeOther = 303;

function fetchHeadersOf(headers: NodeHeaders): Headers {
  return new Headers(
    Object.entries(headers).flatMap((entry: readonly [string, NodeHeaders[string]]) =>
      [entry[1]].flat().map((each): [string, string] => [entry[0], String(each)]),
    ),
  );
}

function withScriptsByTheirHash(policy: string): string {
  return `${policy}; script-src 'none'`;
}

const noneBesideAHash = /script-src 'none'(?= 'sha256-)/u;

function withTheHashAlone(ctx: KoaContextWithOIDC): void {
  const policy = ctx.response.get('content-security-policy');
  const alone = policy.replace(noneBesideAHash, 'script-src');
  if (alone !== policy) {
    ctx.set('content-security-policy', alone);
  }
}

async function answeredBy(ctx: KoaContextWithOIDC, answer: Readonly<Response>): Promise<void> {
  answer.headers.forEach((value, name) => {
    ctx.set(name, value);
  });
  ctx.body = await answer.text();
  ctx.status = answer.status;
}

const referrerPolicyOfItsForms = 'same-origin';

function passedWith(ctx: KoaContextWithOIDC, headers: Readonly<Headers>): void {
  headers.forEach((value, name) => {
    ctx.set(name, name === 'content-security-policy' ? withScriptsByTheirHash(value) : value);
  });
  ctx.set('referrer-policy', referrerPolicyOfItsForms);
}

function behindItsPublicAddress(issuer: string, middleware: ApiMiddleware) {
  const { protocol, host } = new URL(issuer);
  return async (ctx: KoaContextWithOIDC, next: Next): Promise<unknown> => {
    ctx.request.headers['x-forwarded-proto'] = protocol.slice(0, -1);
    ctx.request.headers['x-forwarded-host'] = host;
    const asked = new Request(new URL(ctx.originalUrl, issuer), {
      method: ctx.method,
      headers: fetchHeadersOf(ctx.req.headers),
    });
    const outcome = await middleware(asked);
    if ('answered' in outcome) {
      await answeredBy(ctx, outcome.answered);
      return undefined;
    }
    passedWith(ctx, outcome.passed);
    await next();
    withTheHashAlone(ctx);
    return undefined;
  };
}

const endOfTheForm = '</form>';

const submitsItself = 'document.forms[0].submit()';

function confirmedSigningOut(form: string): string {
  return form.replace(endOfTheForm, `<input type="hidden" name="logout" value="yes"/>${endOfTheForm}`);
}

function lastSegmentOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function pagesOf(pages: SignInPages, models: InteractionModels): ServersPages {
  return {
    renderError: async (ctx, out: Readonly<ErrorOut>, error: Readonly<Error>) => {
      if (error instanceof errors.SessionNotFound) {
        await notOpen(ctx, { models, pages }, lastSegmentOf(ctx.path));
        return;
      }
      ctx.type = 'json';
      ctx.body = out;
    },
    logoutSource: (ctx, form) =>
      shown(ctx, pages, { signingOut: { form: confirmedSigningOut(form), script: submitsItself } }),
    postLogoutSuccessSource: (ctx) => {
      ctx.status = seeOther;
      ctx.redirect('/');
    },
  };
}

function clientNameIn(extra: unknown): string | undefined {
  const named: unknown = Predicate.isObject(extra) ? Reflect.get(extra, 'client_name') : undefined;
  return Predicate.isString(named) ? named : undefined;
}

function isForThisServer(token: AccessToken | undefined, issuer: string): token is AccessToken {
  return token?.aud === issuer && token.jkt === undefined;
}

function issuedOf(token: AccessToken, studioClientId: string): IssuedAccessToken {
  const clientId = String(token.clientId);
  return {
    accountId: token.accountId,
    clientId,
    clientName: clientNameIn(token.extra),
    scope: String(token.scope),
    isStudios: clientId === studioClientId,
  };
}

function accessTokenReader({ accessTokenFound, grantFound }: ProviderModels, issuer: string, studioClientId: string) {
  return async (value: string): Promise<IssuedAccessToken | undefined> => {
    const token = await accessTokenFound(value);
    if (!isForThisServer(token, issuer)) {
      return undefined;
    }
    const grant = await grantFound(token.grantId);
    return grant !== undefined && grant.accountId === token.accountId && grant.clientId === token.clientId
      ? issuedOf(token, studioClientId)
      : undefined;
  };
}

function providerOf(issuer: string, configured: (models: ProviderModels) => Configuration) {
  const models: ProviderModels = {
    detailsOf: (ctx) => provider.interactionDetails(ctx.req, ctx.res),
    resultOf: (ctx, result, merged) =>
      provider.interactionResult(ctx.req, ctx.res, result, { mergeWithLastSubmission: merged }),
    interactionFound: (uid) => provider.Interaction.find(uid, { ignoreExpiration: true }),
    clientNameOf: async (clientId) => (await provider.Client.find(clientId))?.clientName,
    grantFound: (grantId) => provider.Grant.find(grantId),
    codeFound: (value) => provider.AuthorizationCode.find(value),
    grantMade: (accountId, clientId) => new provider.Grant({ accountId, clientId }),
    accessTokenFound: (value) => provider.AccessToken.find(value),
  };
  const provider = new Provider(issuer, configured(models));
  provider.proxy = true;
  return { provider, models };
}

export function authorizationServerOf(
  settings: AuthorizationServerSettings,
  parts: AuthorizationServerParts,
): AuthorizationServer {
  const { issuer, studio } = settings;
  const { middleware, signIn, pages, signInCallbackPath, now = Date.now, linking } = parts;
  const { provider, models } = providerOf(issuer, (made) =>
    configurationOf(settings, { ...parts, now, linking: linking !== undefined }, pagesOf(pages, made)),
  );
  provider.use(behindItsPublicAddress(issuer, middleware));
  provider.use(interactionsOf({ issuer, models, signIn, pages, signInCallbackPath, linking }));
  const handled = provider.callback();
  return {
    issuer,
    answers: answeredPathsOf(signInCallbackPath, linking !== undefined),
    listener: (request, response) => {
      void handled(request, response);
    },
    accessTokenOf: accessTokenReader(models, issuer, studio.clientId),
  };
}

export type { AuthorizationServerSettings, PersonClaims, StudioClient } from './configuration.ts';
export type {
  AccountLinking,
  AllowAsked,
  InteractionSignIn,
  LinkAllowAsked,
  LinkChoices,
  LinkShown,
  ServiceNamed,
  InvitationOpened,
  NotStarted,
  PageShown,
  SignInAskedOf,
  SignInOutcome,
  SignInPage,
  SignInPages,
  SignInRefusal,
  UpstreamSignInStarted,
} from './interaction-pages.ts';
export type { ProviderRows } from './provider-rows.ts';
export type { SigningKeyRows } from './signing-key-rows.ts';
export { signingKeyOf, type KeptSecrets, type SigningKey } from './signing-key.ts';
