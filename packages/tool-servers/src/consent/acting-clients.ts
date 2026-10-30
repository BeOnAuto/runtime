import {
  createPrivateKeyJwtAuth,
  type AddClientAuthentication,
  type FetchLike,
  type OAuthClientInformationFull,
} from '@modelcontextprotocol/client';
import { required } from '@on.auto/operations';
import { fetchWithin, type Reaches } from '@on.auto/outbound';
import { Effect, Redacted } from 'effect';

import {
  clientMetadataDocumentOf,
  metadataDocumentOf,
  registeredClientFor,
  registeredClientNamed,
  type ClientMetadataDocument,
  type ClientSource,
  type ClientsHad,
  type OwnClient,
  type RegisteredClient,
  type WayClientSource,
} from './client-sources.ts';
import type {
  ChosenClient,
  ClientRegistrations,
  ConsentAsked,
  ConsentRefusal,
  FinishAsked,
  KeptRegistration,
  Refused,
} from './consent-client.ts';
import {
  registrationFieldsOf,
  registrationFor,
  registrationUnavailable,
  type RegistrationKeeping,
} from './dynamic-registration.ts';
import { handGivenUrlOf, type AuthorizationServer } from './server-metadata.ts';

export interface ClientIdentity {
  readonly client_id: string;
  readonly client_secret?: string;
  readonly token_endpoint_auth_method?: string;
  readonly redirect_uris: readonly string[];
}

export interface ActingClient {
  readonly chosen: ChosenClient;
  readonly identity: ClientIdentity;
  readonly authentication: AddClientAuthentication | undefined;
}

interface ClientChoosing extends Omit<ClientsHad, 'serviceClients'>, RegistrationKeeping {
  readonly registrations: ClientRegistrations;
}

export type ServerSource = Exclude<ClientSource, 'auto'>;

export type MadeSource = Exclude<WayClientSource, 'registered'>;

type RegisteredSource = Extract<ClientSource, 'registered' | 'own'>;

interface Taking {
  readonly asked: ConsentAsked;
  readonly server: AuthorizationServer;
  readonly fetch: FetchLike;
  readonly sources: readonly ServerSource[];
}

type RecordedClient = Pick<FinishAsked, 'way' | 'client' | 'returnAddress' | 'ownClient'>;

interface ClientChoice {
  readonly chosenAt: (taking: Taking) => Effect.Effect<ActingClient, ConsentRefusal>;
  readonly recordedFor: (recorded: RecordedClient) => Effect.Effect<ActingClient, ConsentRefusal>;
}

export const noClient: Refused<'no_client'> = { refused: 'no_client' };

const clientGone: ConsentRefusal = { refused: 'client_gone' };

export function libraryClientOf({
  redirect_uris: redirectUris,
  ...identity
}: ClientIdentity): OAuthClientInformationFull {
  return { ...identity, redirect_uris: [...redirectUris] };
}

function registeredActing(
  { clientId, credential, tokenEndpointAuthMethod }: RegisteredClient,
  returnAddress: string,
  source: RegisteredSource = 'registered',
): ActingClient {
  const secret = credential.kind === 'client_secret' ? { client_secret: Redacted.value(credential.clientSecret) } : {};
  const method = tokenEndpointAuthMethod === null ? {} : { token_endpoint_auth_method: tokenEndpointAuthMethod };
  return {
    chosen: { client_id: clientId, client_source: source },
    identity: { client_id: clientId, redirect_uris: [returnAddress], ...secret, ...method },
    authentication:
      credential.kind === 'private_key'
        ? createPrivateKeyJwtAuth({
            issuer: clientId,
            subject: clientId,
            privateKey: Redacted.value(credential.privateKey),
            alg: credential.algorithm,
          })
        : undefined,
  };
}

function ownActing({ clientId, clientSecret }: OwnClient, returnAddress: string): ActingClient {
  const registered: RegisteredClient = {
    issuers: [],
    clientId,
    credential: { kind: 'client_secret', clientSecret },
    tokenEndpointAuthMethod: null,
  };
  return registeredActing(registered, returnAddress, 'own');
}

function ownActingOf({ ownClient, returnAddress }: ConsentAsked): ActingClient | undefined {
  return ownClient === undefined ? undefined : ownActing(ownClient, returnAddress);
}

function documentedActing({ document }: ClientMetadataDocument): ActingClient {
  const { client_id: clientId, redirect_uris: redirectUris, token_endpoint_auth_method: method } = document;
  return {
    chosen: { client_id: clientId, client_source: 'metadata_document' },
    identity: { client_id: clientId, redirect_uris: redirectUris, token_endpoint_auth_method: method },
    authentication: undefined,
  };
}

function dynamicActing(kept: KeptRegistration, returnAddress: string): ActingClient {
  const { client_id: clientId, ...given } = registrationFieldsOf(kept);
  return {
    chosen: { client_id: clientId, client_source: 'dynamic' },
    identity: { client_id: clientId, ...given, redirect_uris: [returnAddress] },
    authentication: undefined,
  };
}

export function takesMadeSource(
  server: AuthorizationServer,
  source: MadeSource,
  publicUrl: string | undefined,
): boolean {
  return source === 'dynamic'
    ? server.registration_endpoint !== undefined
    : server.client_id_metadata_document_supported === true && metadataDocumentOf(publicUrl) !== undefined;
}

function originOf(url: string | undefined): string | null {
  return url === undefined ? null : new URL(url).origin;
}

function dynamicallyRegistered(
  { asked, server, fetch }: Taking,
  choosing: ClientChoosing,
): Effect.Effect<ActingClient, ConsentRefusal> {
  const { returnAddress } = asked;
  const place = { issuer: asked.way.issuer, server: originOf(handGivenUrlOf(asked.server)) };
  const registration = {
    place,
    endpoint: required(server.registration_endpoint),
    returnAddress,
    tokenEndpointMethods: server.token_endpoint_auth_methods_supported,
    fetch,
  };
  return Effect.map(registrationFor(registration, choosing), (kept) => dynamicActing(kept, returnAddress));
}

function madeTakenFrom(
  source: MadeSource,
  taking: Taking,
  choosing: ClientChoosing,
): Effect.Effect<ActingClient | undefined, ConsentRefusal> {
  const { asked, server } = taking;
  if (!takesMadeSource(server, source, choosing.publicUrl)) {
    return Effect.undefined;
  }
  return source === 'dynamic'
    ? dynamicallyRegistered(taking, choosing)
    : Effect.succeed(documentedActing(required(clientMetadataDocumentOf(choosing.publicUrl, asked.returnAddress))));
}

function takenFrom(
  source: ServerSource,
  taking: Taking,
  choosing: ClientChoosing,
): Effect.Effect<ActingClient | undefined, ConsentRefusal> {
  const { asked } = taking;
  if (source === 'registered') {
    return Effect.succeed(
      registeredActing(required(registeredClientFor(choosing.registeredClients, asked.way)), asked.returnAddress),
    );
  }
  return source === 'own' ? Effect.succeed(ownActingOf(asked)) : madeTakenFrom(source, taking, choosing);
}

function chosenAt(taking: Taking, choosing: ClientChoosing): Effect.Effect<ActingClient, ConsentRefusal> {
  return Effect.gen(function* () {
    for (const source of taking.sources) {
      const taken = yield* takenFrom(source, taking, choosing);
      if (taken !== undefined) {
        return taken;
      }
    }
    return yield* Effect.fail(noClient);
  });
}

function recordedOf(
  { way, client, returnAddress, ownClient }: RecordedClient,
  choosing: ClientChoosing,
): ActingClient | undefined {
  if (client.client_source === 'registered') {
    const registered = registeredClientNamed(choosing.registeredClients, way.issuer, client.client_id);
    return registered === undefined ? undefined : registeredActing(registered, returnAddress);
  }
  if (client.client_source === 'own') {
    return ownClient?.clientId === client.client_id ? ownActing(ownClient, returnAddress) : undefined;
  }
  const documented = clientMetadataDocumentOf(choosing.publicUrl, returnAddress);
  return documented?.address === client.client_id ? documentedActing(documented) : undefined;
}

function recordedFor(recorded: RecordedClient, choosing: ClientChoosing): Effect.Effect<ActingClient, ConsentRefusal> {
  const { way, client, returnAddress } = recorded;
  if (client.client_source === 'dynamic') {
    return choosing.registrations.named(way.issuer, client.client_id).pipe(
      Effect.mapError(registrationUnavailable),
      Effect.flatMap((kept) =>
        kept === undefined ? Effect.fail(clientGone) : Effect.succeed(dynamicActing(kept, returnAddress)),
      ),
    );
  }
  const acting = recordedOf(recorded, choosing);
  return acting === undefined ? Effect.fail(clientGone) : Effect.succeed(acting);
}

function clientChoice(choosing: ClientChoosing): ClientChoice {
  return {
    chosenAt: (taking) => chosenAt(taking, choosing),
    recordedFor: (recorded) => recordedFor(recorded, choosing),
  };
}

export function isServerSource(source: ClientSource): source is ServerSource {
  return source !== 'auto';
}

export interface Requesting extends ClientChoosing {
  readonly fetch: FetchLike;
  readonly requestMs: number;
  readonly requestTimeout: (ms: number) => AbortSignal;
}

export interface Requests {
  readonly clients: ClientChoice;
  readonly fetchFor: (reaches: Reaches) => FetchLike;
}

function boundedFetchOf({ fetch, requestMs, requestTimeout }: Requesting, reaches: Reaches): FetchLike {
  const within = fetchWithin(fetch, reaches);
  return (...[address, init]: readonly [unknown, unknown?]) =>
    within(String(address), Object.assign({}, init, { signal: requestTimeout(requestMs) }));
}

export function requestsOf(requesting: Requesting): Requests {
  return {
    clients: clientChoice(requesting),
    fetchFor: (reaches) => boundedFetchOf(requesting, reaches),
  };
}
