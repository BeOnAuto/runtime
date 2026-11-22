import { Predicate } from 'effect';
import { errors, type InteractionResults, type KoaContextWithOIDC, type Provider } from 'oidc-provider';

import { isLinking, linkAllowAsked, linkAnswered, type LinkingModels, type LinksServed } from './account-linking.ts';
import { redirectedTo, shown, signInCookieAttributes } from './answering.ts';
import type { InteractionSignIn, PageShown, SignInOutcome, SignInPages, SignInRefusal } from './interaction-pages.ts';
import { invitationCarriedAndCleared, invitationOpened, invitationSecretIn } from './invitation-link.ts';
import { abortedStep, confirmedStep, federatedStep, interactionAddressOf, interactionPath } from './paths.ts';

type Interaction = Awaited<ReturnType<Provider['interactionDetails']>>;

type Grant = InstanceType<Provider['Grant']>;

type Params = Interaction['params'];

const pendingSignInCookie = '__Host-Http-sign-in';

const pendingSignInMs = 600_000;

const selectAccount = 'select_account';

const consentPrompt = 'consent';

export interface InteractionModels extends LinkingModels {
  readonly detailsOf: (ctx: KoaContextWithOIDC) => Promise<Interaction>;
  readonly resultOf: (ctx: KoaContextWithOIDC, result: InteractionResults, merged: boolean) => Promise<string>;
  readonly interactionFound: (uid: string) => Promise<Interaction | undefined>;
  readonly clientNameOf: (clientId: string) => Promise<unknown>;
  readonly grantFound: (grantId: string) => Promise<Grant | undefined>;
  readonly grantMade: (accountId: string | undefined, clientId: string | undefined) => Grant;
}

export interface InteractionsServed {
  readonly issuer: string;
  readonly models: InteractionModels;
  readonly signIn: InteractionSignIn;
  readonly pages: SignInPages;
  readonly signInCallbackPath: string;
  readonly linking: LinksServed['linking'] | undefined;
}

type Next = () => Promise<unknown>;

async function interactionIn(
  ctx: KoaContextWithOIDC,
  { detailsOf }: InteractionModels,
  uid: string,
): Promise<Interaction | undefined> {
  try {
    const interaction = await detailsOf(ctx);
    return interaction.uid === uid ? interaction : undefined;
  } catch (failure) {
    if (failure instanceof errors.SessionNotFound) {
      return undefined;
    }
    throw failure;
  }
}

function parameterOf(params: Params, name: string): string {
  return String(params[name]);
}

function documentHostOf(clientId: string): string | undefined {
  const address = URL.parse(clientId);
  return address?.protocol === 'https:' ? address.host : undefined;
}

async function clientNamed(models: InteractionModels, params: Params): Promise<string> {
  const named = await models.clientNameOf(parameterOf(params, 'client_id'));
  return Predicate.isString(named) && named !== '' ? named : new URL(parameterOf(params, 'redirect_uri')).host;
}

export async function notOpen(
  ctx: KoaContextWithOIDC,
  served: Pick<InteractionsServed, 'models' | 'pages'>,
  uid: string,
): Promise<void> {
  const interaction = await served.models.interactionFound(uid);
  const client =
    interaction === undefined || isLinking(interaction.params)
      ? undefined
      : await clientNamed(served.models, interaction.params);
  await shown(ctx, served.pages, { notOpen: { client } });
}

function linksOf({ issuer, models, pages, linking }: InteractionsServed): LinksServed | undefined {
  return linking === undefined ? undefined : { issuer, models, pages, linking };
}

function asksToSelectAnAccount(ctx: KoaContextWithOIDC, interaction: Interaction): boolean {
  return interaction.prompt.name === selectAccount || ctx.query['prompt'] === selectAccount;
}

async function signInStarted(
  ctx: KoaContextWithOIDC,
  served: InteractionsServed,
  interaction: Interaction,
): Promise<void> {
  const started = await served.signIn.started({ selectAccount: asksToSelectAnAccount(ctx, interaction) });
  if ('notStarted' in started) {
    await shown(ctx, served.pages, { refused: 'not_signed_in', tryAgainAt: interactionAddressOf(interaction.uid) });
    return;
  }
  ctx.cookies.set(pendingSignInCookie, `${interaction.uid}.${started.pending}`, {
    ...signInCookieAttributes,
    maxAge: pendingSignInMs,
  });
  redirectedTo(ctx, started.location);
}

async function allowAsked(
  ctx: KoaContextWithOIDC,
  served: InteractionsServed,
  interaction: Interaction,
): Promise<void> {
  const { params, uid } = interaction;
  const linksServed = linksOf(served);
  if (linksServed !== undefined && isLinking(params)) {
    await linkAllowAsked(ctx, linksServed, { uid, state: params['state'] });
    return;
  }
  await shown(ctx, served.pages, {
    allow: {
      client: await clientNamed(served.models, params),
      publishedAt: documentHostOf(parameterOf(params, 'client_id')),
      deliveredTo: parameterOf(params, 'redirect_uri'),
      allowAt: interactionAddressOf(interaction.uid, confirmedStep),
      denyAt: interactionAddressOf(interaction.uid, abortedStep),
    },
  });
}

async function interactionShown(ctx: KoaContextWithOIDC, served: InteractionsServed, uid: string): Promise<void> {
  const interaction = await interactionIn(ctx, served.models, uid);
  if (interaction === undefined) {
    await notOpen(ctx, served, uid);
    return;
  }
  await (interaction.prompt.name === consentPrompt
    ? allowAsked(ctx, served, interaction)
    : signInStarted(ctx, served, interaction));
}

function namesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each) => Predicate.isString(each)) : [];
}

function missingResourceScopesOf(details: Interaction['prompt']['details']): ReadonlyMap<string, string[]> {
  const missing = details['missingResourceScopes'];
  const entries = Predicate.isObject(missing) ? Object.entries(missing) : [];
  return new Map(entries.map((entry: readonly [string, unknown]) => [entry[0], namesOf(entry[1])]));
}

async function grantedOn(models: InteractionModels, interaction: Interaction): Promise<string> {
  const found = interaction.grantId === undefined ? undefined : await models.grantFound(interaction.grantId);
  const grant = found ?? models.grantMade(interaction.session?.accountId, parameterOf(interaction.params, 'client_id'));
  const { details } = interaction.prompt;
  grant.addOIDCScope(namesOf(details['missingOIDCScope']));
  grant.addOIDCClaims(namesOf(details['missingOIDCClaims']));
  for (const [resource, scopes] of missingResourceScopesOf(details)) {
    grant.addResourceScope(resource, scopes);
  }
  return grant.save();
}

async function finished(
  ctx: KoaContextWithOIDC,
  models: InteractionModels,
  result: InteractionResults,
  merged: boolean,
): Promise<void> {
  redirectedTo(ctx, await models.resultOf(ctx, result, merged));
}

async function decided(ctx: KoaContextWithOIDC, served: InteractionsServed, uid: string, step: string): Promise<void> {
  const interaction = await interactionIn(ctx, served.models, uid);
  if (interaction?.prompt.name !== consentPrompt) {
    await notOpen(ctx, served, uid);
    return;
  }
  if (step === abortedStep) {
    await finished(ctx, served.models, { error: 'access_denied' }, false);
    return;
  }
  await finished(ctx, served.models, { consent: { grantId: await grantedOn(served.models, interaction) } }, true);
}

interface PendingSignIn {
  readonly uid: string;
  readonly pending: string;
}

function pendingOf(ctx: KoaContextWithOIDC): PendingSignIn | undefined {
  const value = ctx.cookies.get(pendingSignInCookie) ?? '';
  const at = value.indexOf('.');
  return at < 1 ? undefined : { uid: value.slice(0, at), pending: value.slice(at + 1) };
}

async function signInCallbackAnswered(ctx: KoaContextWithOIDC, served: InteractionsServed): Promise<void> {
  const pending = pendingOf(ctx);
  if (pending === undefined) {
    await shown(ctx, served.pages, { refused: 'not_signed_in', tryAgainAt: undefined });
    return;
  }
  redirectedTo(ctx, `${interactionAddressOf(pending.uid, federatedStep)}${ctx.search}`);
}

type Admitting = Exclude<SignInOutcome, { readonly refused: SignInRefusal }>;

function signedInResult(outcome: Admitting, interaction: Interaction): InteractionResults {
  if ('gaveUp' in outcome) {
    return { error: 'access_denied' };
  }
  const selected = interaction.prompt.name === selectAccount ? { [selectAccount]: {} } : {};
  return { login: { accountId: outcome.admitted }, ...selected };
}

function refusalShown(uid: string, refused: SignInRefusal): PageShown {
  return {
    refused,
    tryAgainAt:
      refused === 'not_that_account'
        ? `${interactionAddressOf(uid)}?prompt=${selectAccount}`
        : interactionAddressOf(uid),
  };
}

async function signInFinished(ctx: KoaContextWithOIDC, served: InteractionsServed, uid: string): Promise<void> {
  const pending = pendingOf(ctx);
  const invitation = invitationCarriedAndCleared(ctx);
  ctx.cookies.set(pendingSignInCookie, null, signInCookieAttributes);
  const interaction = await interactionIn(ctx, served.models, uid);
  if (interaction === undefined) {
    await notOpen(ctx, served, uid);
    return;
  }
  const outcome = await served.signIn.finished(
    ctx.search,
    pending?.uid === uid ? pending.pending : undefined,
    invitation,
  );
  if ('refused' in outcome) {
    await shown(ctx, served.pages, refusalShown(uid, outcome.refused));
    return;
  }
  const result = signedInResult(outcome, interaction);
  await finished(ctx, served.models, result, 'login' in result);
}

interface Step {
  readonly uid: string;
  readonly step: string;
}

function stepOf(path: string): Step | undefined {
  if (!path.startsWith(`${interactionPath}/`)) {
    return undefined;
  }
  const [uid = '', step = ''] = path.slice(interactionPath.length + 1).split('/');
  return { uid, step };
}

type StepAnswer = (ctx: KoaContextWithOIDC, served: InteractionsServed, uid: string) => Promise<void>;

const stepsAnswered: ReadonlyMap<string, StepAnswer> = new Map([
  ['GET ', interactionShown],
  [`GET ${federatedStep}`, signInFinished],
  [`POST ${confirmedStep}`, (ctx, served, uid) => decided(ctx, served, uid, confirmedStep)],
  [`POST ${abortedStep}`, (ctx, served, uid) => decided(ctx, served, uid, abortedStep)],
]);

function answeredStep(ctx: KoaContextWithOIDC, served: InteractionsServed): Promise<void> | undefined {
  const at = stepOf(ctx.path);
  const answer = at === undefined ? undefined : stepsAnswered.get(`${ctx.method} ${at.step}`);
  return at === undefined || answer === undefined ? undefined : answer(ctx, served, at.uid);
}

export function interactionsOf(served: InteractionsServed): (ctx: KoaContextWithOIDC, next: Next) => Promise<unknown> {
  return (ctx, next) => {
    if (ctx.method === 'GET' && ctx.path === served.signInCallbackPath) {
      return signInCallbackAnswered(ctx, served);
    }
    const linksServed = linksOf(served);
    const linked = linksServed === undefined ? undefined : linkAnswered(ctx, linksServed);
    if (linked !== undefined) {
      return linked;
    }
    const secret = ctx.method === 'GET' ? invitationSecretIn(ctx.path) : undefined;
    if (secret !== undefined) {
      return invitationOpened(ctx, served, secret);
    }
    return answeredStep(ctx, served) ?? next();
  };
}
