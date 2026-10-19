import {
  createPrivateKeyJwtAuth,
  type AddClientAuthentication,
  type FetchLike,
  type OAuthClientInformationFull,
} from '@modelcontextprotocol/client';
import { fetchWithin, type Reaches } from '@on.auto/outbound';
import { Effect, Option, Redacted } from 'effect';

import {
  clientMetadataDocumentOf,
  registeredClientAt,
  sourcesHad,
  type ClientMetadataDocument,
  type ClientSource,
  type ClientsHad,
  type RegisteredClient,
} from './client-sources.ts';
import type {
  ChosenClient,
  ClientRegistrations,
  ConsentAsked,
  ConsentRefusal,
  FinishAsked,
  KeptRegistration,
} from './consent-client.ts';
import { registrationFieldsOf, registrationFor, singleFlight, type Registering } from './dynamic-registration.ts';
import type { AuthorizationServer } from './server-metadata.ts';

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

interface ClientChoosing extends ClientsHad {
  readonly registrations: ClientRegistrations;
}

interface Taking {
  readonly asked: ConsentAsked;
  readonly server: AuthorizationServer;
  readonly fetch: FetchLike;
}

type RecordedClient = Pick<FinishAsked, 'way' | 'client' | 'returnAddress'>;

interface ClientChoice {
  readonly chosenAt: (taking: Taking) => Effect.Effect<ActingClient, ConsentRefusal>;
  readonly recordedFor: (recorded: RecordedClient) => Effect.Effect<ActingClient, ConsentRefusal>;
}

interface Choosing extends ClientChoosing {
  readonly registeredOnce: Registering;
}

const noClient: ConsentRefusal = { refused: 'no_client' };

const clientGone: ConsentRefusal = { refused: 'client_gone' };

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

export function libraryClientOf({
  redirect_uris: redirectUris,
  ...identity
}: ClientIdentity): OAuthClientInformationFull {
  return { ...identity, redirect_uris: [...redirectUris] };
}

function registeredActing(
  { clientId, credential, tokenEndpointAuthMethod }: RegisteredClient,
  returnAddress: string,
): ActingClient {
  const secret = credential.kind === 'client_secret' ? { client_secret: Redacted.value(credential.clientSecret) } : {};
  const method = tokenEndpointAuthMethod === null ? {} : { token_endpoint_auth_method: tokenEndpointAuthMethod };
  return {
    chosen: { client_id: clientId, client_source: 'registered' },
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
    identity: { client_id: clientId, redirect_uris: [returnAddress], ...given },
    authentication: undefined,
  };
}

function dynamicallyRegistered(
  { asked, server, fetch }: Taking,
  { registrations, registeredOnce }: Choosing,
): Effect.Effect<ActingClient | undefined, ConsentRefusal> {
  const endpoint = server.registration_endpoint;
  if (endpoint === undefined) {
    return Effect.undefined;
  }
  const { returnAddress } = asked;
  const registration = { issuer: asked.way.issuer, endpoint, returnAddress, fetch };
  return Effect.map(registrationFor(registration, registrations, registeredOnce), (kept) =>
    dynamicActing(kept, returnAddress),
  );
}

function takenFrom(
  source: ClientSource,
  taking: Taking,
  choosing: Choosing,
): Effect.Effect<ActingClient | undefined, ConsentRefusal> {
  const { asked, server } = taking;
  if (source === 'registered') {
    return Effect.succeed(
      registeredActing(required(registeredClientAt(choosing.registeredClients, asked.way.issuer)), asked.returnAddress),
    );
  }
  if (source === 'metadata_document') {
    return Effect.succeed(
      server.client_id_metadata_document_supported === true
        ? documentedActing(required(clientMetadataDocumentOf(choosing.publicUrl, asked.returnAddress)))
        : undefined,
    );
  }
  return dynamicallyRegistered(taking, choosing);
}

function chosenAt(taking: Taking, choosing: Choosing): Effect.Effect<ActingClient, ConsentRefusal> {
  return Effect.gen(function* () {
    for (const source of sourcesHad(taking.asked.way, choosing)) {
      const taken = yield* takenFrom(source, taking, choosing);
      if (taken !== undefined) {
        return taken;
      }
    }
    return yield* Effect.fail(noClient);
  });
}

function recordedOf({ way, client, returnAddress }: RecordedClient, choosing: Choosing): ActingClient | undefined {
  if (client.client_source === 'registered') {
    const registered = registeredClientAt(choosing.registeredClients, way.issuer);
    return registered?.clientId === client.client_id ? registeredActing(registered, returnAddress) : undefined;
  }
  const documented = clientMetadataDocumentOf(choosing.publicUrl, returnAddress);
  return documented?.address === client.client_id ? documentedActing(documented) : undefined;
}

function recordedFor(recorded: RecordedClient, choosing: Choosing): Effect.Effect<ActingClient, ConsentRefusal> {
  const { way, client, returnAddress } = recorded;
  if (client.client_source === 'dynamic') {
    return Effect.flatMap(choosing.registrations.named(way.issuer, client.client_id), (kept) =>
      kept === undefined ? Effect.fail(clientGone) : Effect.succeed(dynamicActing(kept, returnAddress)),
    );
  }
  const acting = recordedOf(recorded, choosing);
  return acting === undefined ? Effect.fail(clientGone) : Effect.succeed(acting);
}

function clientChoice(choosing: ClientChoosing): ClientChoice {
  const choosingOnce: Choosing = { ...choosing, registeredOnce: singleFlight() };
  return {
    chosenAt: (taking) => chosenAt(taking, choosingOnce),
    recordedFor: (recorded) => recordedFor(recorded, choosingOnce),
  };
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
