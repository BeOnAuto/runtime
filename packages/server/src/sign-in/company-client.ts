import {
  providerRequestsOverTheNetwork,
  registeringProviderOf,
  relyingPartyOf,
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

export interface SignInAt {
  readonly publicUrl: string;
  readonly requiredClaim: RequiredClaim | undefined;
}

interface SignInAsAGivenClient extends SignInAt {
  readonly relyingParty: RelyingParty;
}

interface SignInAsARegisteredClient extends SignInAt {
  readonly registering: RegisteringProvider;
}

export type CompanySignIn = SignInAsAGivenClient | SignInAsARegisteredClient;

function clientNameAt(publicUrl: string): string {
  return `Auto Runtime at ${new URL(publicUrl).host}`;
}

export async function companySignInOf(
  settings: OpenIdConnectSettings,
  requests: ProviderRequests = providerRequestsOverTheNetwork,
): Promise<CompanySignIn> {
  const { publicUrl, requiredClaim, client } = settings;
  if (client !== undefined) {
    return { relyingParty: await relyingPartyOf({ ...settings, ...client }, requests), publicUrl, requiredClaim };
  }
  const clientName = clientNameAt(publicUrl);
  const registering = await registeringProviderOf({ ...settings, clientName }, requests).catch((failure: unknown) => {
    throw refusedAtStart(failure);
  });
  return { registering, publicUrl, requiredClaim };
}

export function issuerOf(signIn: CompanySignIn): string {
  return 'relyingParty' in signIn ? signIn.relyingParty.issuer : signIn.registering.issuer;
}

export interface AsItsClient {
  readonly relyingParty: RelyingParty;
  readonly pending: PendingCookie;
}

export interface ClientsServed {
  readonly registrations: () => SignInClientRegistrations;
  readonly report: ClientsReport;
}

export async function asItsClient(
  signIn: CompanySignIn,
  { registrations, report }: ClientsServed,
): Promise<AsItsClient> {
  if ('relyingParty' in signIn) {
    return { relyingParty: signIn.relyingParty, pending: pendingCookieOf(false) };
  }
  const clients = registeredClientsOf(signIn.registering, registrations(), report);
  await clients.inUse().catch((failure: unknown) => {
    throw refusedAtStart(failure);
  });
  return { relyingParty: signIn.registering.relyingPartyOf(clients), pending: pendingCookieOf(true) };
}
