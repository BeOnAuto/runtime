import {
  ClientRegistrationError,
  providerRequestsOverTheNetwork,
  registeringProviderOf,
  relyingPartyOf,
  UnusableIdentityProviderError,
  type ProviderRequests,
  type RegisteringProvider,
  type RelyingParty,
  type RequiredClaim,
} from '@on.auto/openid-connect';

import type { ClientsReport } from '../logging/sign-in-logging.ts';
import type { OpenIdConnectSettings } from '../settings/openid-connect-settings.ts';
import type { SignInClientRegistrations } from './client-registrations.ts';
import { pendingCookieOf, type PendingCookie } from './pending-sign-in.ts';
import { registeredClientsOf } from './registered-clients.ts';
import { refusedAtStart } from './registration-refusals.ts';

interface SignInAt {
  readonly publicUrl: string;
  readonly requiredClaim: RequiredClaim | undefined;
}

interface SignInAsAGivenClient extends SignInAt {
  readonly relyingParty: RelyingParty;
}

interface SignInAsARegisteredClient extends SignInAt {
  readonly registering: RegisteringProvider;
}

interface SignInRegisteredAtFirstUse extends SignInAt {
  readonly issuer: string;
  readonly redirectUri: string;
  readonly registeringAtFirstUse: () => Promise<RegisteringProvider>;
}

export type CompanySignIn = SignInAsAGivenClient | SignInAsARegisteredClient | SignInRegisteredAtFirstUse;

function clientNameAt(publicUrl: string): string {
  return `Auto Runtime at ${new URL(publicUrl).host}`;
}

export function registeringProviderFor(
  settings: OpenIdConnectSettings,
  byDefault: boolean,
  requests: ProviderRequests,
): Promise<RegisteringProvider> {
  const { publicUrl } = settings;
  const introduced = byDefault ? { clientUri: publicUrl } : {};
  return registeringProviderOf({ ...settings, clientName: clientNameAt(publicUrl), ...introduced }, requests);
}

export async function companySignInOf(
  settings: OpenIdConnectSettings,
  requests: ProviderRequests = providerRequestsOverTheNetwork,
): Promise<CompanySignIn> {
  const { publicUrl, requiredClaim, client } = settings;
  if (client !== undefined) {
    return { relyingParty: await relyingPartyOf({ ...settings, ...client }, requests), publicUrl, requiredClaim };
  }
  const registering = await registeringProviderFor(settings, false, requests).catch((failure: unknown) => {
    throw refusedAtStart(failure);
  });
  return { registering, publicUrl, requiredClaim };
}

export function signInByDefaultOf(
  settings: OpenIdConnectSettings,
  requests: ProviderRequests = providerRequestsOverTheNetwork,
): CompanySignIn {
  const { issuer, redirectUri, publicUrl, requiredClaim } = settings;
  return {
    issuer,
    redirectUri,
    publicUrl,
    requiredClaim,
    registeringAtFirstUse: () => registeringProviderFor(settings, true, requests),
  };
}

export function issuerOf(signIn: CompanySignIn): string {
  if ('relyingParty' in signIn) {
    return signIn.relyingParty.issuer;
  }
  return 'registering' in signIn ? signIn.registering.issuer : signIn.issuer;
}

export interface AsItsClient {
  readonly relyingParty: RelyingParty;
  readonly pending: PendingCookie;
}

export interface ClientsServed {
  readonly registrations: () => SignInClientRegistrations;
  readonly report: ClientsReport;
}

function onceMade<Made>(make: () => Promise<Made>): () => Promise<Made> {
  const kept: { making?: Promise<Made> } = {};
  return () => {
    kept.making ??= make().catch((failure: unknown) => {
      delete kept.making;
      throw failure;
    });
    return kept.making;
  };
}

function asUnusable(failure: unknown): unknown {
  return failure instanceof ClientRegistrationError
    ? new UnusableIdentityProviderError({ message: failure.message })
    : failure;
}

function registeredAtFirstUse(
  signIn: SignInRegisteredAtFirstUse,
  registrations: SignInClientRegistrations,
  report: ClientsReport,
): RelyingParty {
  const prepared = onceMade(async () => {
    const registering = await signIn.registeringAtFirstUse();
    const clients = registeredClientsOf(registering, registrations, report);
    await clients.inUse();
    return registering.relyingPartyOf(clients);
  });
  const usable = () =>
    prepared().catch((failure: unknown) => {
      throw asUnusable(failure);
    });
  return {
    issuer: signIn.issuer,
    redirectUri: signIn.redirectUri,
    signInStarted: async (asked) => (await usable()).signInStarted(asked),
    signInFinished: (callbackQuery, pending) =>
      usable().then(
        (relyingParty) => relyingParty.signInFinished(callbackQuery, pending),
        (failure: unknown) => {
          if (failure instanceof UnusableIdentityProviderError) {
            return { failed: failure.message };
          }
          throw failure;
        },
      ),
  };
}

export async function asItsClient(
  signIn: CompanySignIn,
  { registrations, report }: ClientsServed,
): Promise<AsItsClient> {
  if ('relyingParty' in signIn) {
    return { relyingParty: signIn.relyingParty, pending: pendingCookieOf(false) };
  }
  if ('registeringAtFirstUse' in signIn) {
    return { relyingParty: registeredAtFirstUse(signIn, registrations(), report), pending: pendingCookieOf(true) };
  }
  const clients = registeredClientsOf(signIn.registering, registrations(), report);
  await clients.inUse().catch((failure: unknown) => {
    throw refusedAtStart(failure);
  });
  return { relyingParty: signIn.registering.relyingPartyOf(clients), pending: pendingCookieOf(true) };
}
