import { Result } from 'effect';

import { UnusableIdentityProviderError, usableProviderOf, type SignInsAs } from './client-configuration.ts';
import {
  clientRegisteredAt,
  clientRegistrationError,
  type ClientRegistering,
  type RegisteredClient,
  type RelyingPartyClient,
} from './client-registration.ts';
import {
  authorizationServerMetadataAddressOf,
  metadataAddressOf,
  registrationEndpointOf,
} from './provider-metadata.ts';
import { providerRequestsOverTheNetwork, type ProviderRequests } from './provider-requests.ts';
import { relyingPartyAs, type RelyingParty, type RelyingPartySettings } from './relying-party.ts';

export interface RelyingPartyClients {
  readonly inUse: () => Promise<RelyingPartyClient>;
  readonly named: (clientId: string) => Promise<RelyingPartyClient | undefined>;
  readonly refused: (client: RelyingPartyClient) => Promise<void>;
}

export interface RegisteringSettings extends Omit<RelyingPartySettings, 'clientId' | 'clientSecret'> {
  readonly clientName: string;
  readonly clientUri?: string;
}

export interface RegisteringProvider {
  readonly issuer: string;
  readonly redirectUri: string;
  readonly registered: (nowMs?: number) => Promise<RegisteredClient>;
  readonly relyingPartyOf: (clients: RelyingPartyClients) => RelyingParty;
}

function signInsKeptBy(made: (client: RelyingPartyClient) => SignInsAs): (client: RelyingPartyClient) => SignInsAs {
  const kept = new Map<string, SignInsAs>();
  return (client) => {
    const signIns = kept.get(client.clientId) ?? made(client);
    kept.set(client.clientId, signIns);
    return signIns;
  };
}

async function registrationEndpointAt(
  { issuer, redirectUri }: RegisteringSettings,
  declaredBeside: string | undefined,
  requests: ProviderRequests,
): Promise<string> {
  const read = await registrationEndpointOf(issuer, declaredBeside, requests);
  if (read === 'not_declared') {
    const notOffered = [metadataAddressOf(issuer), authorizationServerMetadataAddressOf(issuer)];
    throw clientRegistrationError({ issuer, redirectUri }, { notOffered });
  }
  if (Result.isFailure(read)) {
    throw new UnusableIdentityProviderError({
      message: `The identity provider at ${issuer} cannot be used: ${read.failure}`,
    });
  }
  return read.success;
}

export async function registeringProviderOf(
  settings: RegisteringSettings,
  requests: ProviderRequests = providerRequestsOverTheNetwork,
): Promise<RegisteringProvider> {
  const provider = await usableProviderOf(settings, requests);
  const endpoint = await registrationEndpointAt(settings, provider.registrationEndpoint, requests);
  const { issuer, redirectUri, scopes, clientName, clientUri } = settings;
  const registering: ClientRegistering = {
    issuer,
    redirectUri,
    endpoint,
    scopes,
    tokenEndpointAuthMethod: provider.method,
    clientName,
    ...(clientUri === undefined ? {} : { clientUri }),
  };
  const signInsAs = signInsKeptBy(provider.signInsAs);
  return {
    issuer,
    redirectUri,
    registered: (nowMs) => clientRegisteredAt(registering, requests, nowMs),
    relyingPartyOf: (clients) =>
      relyingPartyAs(settings, {
        starting: async () => {
          const client = await clients.inUse();
          return { signIns: signInsAs(client), noted: client.clientId };
        },
        finishing: async ({ clientId }) => {
          const client = clientId === undefined ? undefined : await clients.named(clientId);
          return client === undefined
            ? undefined
            : { signIns: signInsAs(client), refused: () => clients.refused(client) };
        },
      }),
  };
}
