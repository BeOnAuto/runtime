import type { AppRuntime } from '@on.auto/api';
import { byTheRuntime } from '@on.auto/connections';
import { clientAuthenticationMethods, type RegisteredClient } from '@on.auto/openid-connect';
import {
  ActedContextSchema,
  Conflict,
  factOf,
  type Context,
  type Decided,
  type Decider,
  type DispatcherServices,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import type { SecretStore } from '@on.auto/secrets';
import { Data, DateTime, Effect, Redacted, Result, Schema } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';

export const signInClientRegistrationsStream = 'runtime/sign-in-client-registrations';

export const SignInClientEventSchema = Schema.Union([
  factOf(
    'sign_in_client_registered',
    Schema.Struct({
      issuer: Schema.String,
      redirect_uri: Schema.String,
      client_id: Schema.String,
      secret_id: Schema.String,
    }),
    ActedContextSchema,
  ),
]);

type SignInClientEvent = typeof SignInClientEventSchema.Type;

type Registered = SignInClientEvent['data'];

export interface RegistrationPlace {
  readonly issuer: string;
  readonly redirectUri: string;
}

export interface Registering extends Registered {
  readonly replacing: string | undefined;
  readonly by: string;
  readonly at: string;
}

type Registrations = readonly Registered[];

function latestOf(registrations: Registrations, { issuer, redirectUri }: RegistrationPlace): Registered | undefined {
  return registrations.findLast(
    (registered) => registered.issuer === issuer && registered.redirect_uri === redirectUri,
  );
}

function placeOf({ issuer, redirect_uri: redirectUri }: Registered): RegistrationPlace {
  return { issuer, redirectUri };
}

export const signInClientsDecider: Decider<Registrations, Registering, SignInClientEvent, 'conflict'> = {
  initialState: [],
  evolve: (registrations, { data }) => [...registrations, data],
  decide: (registering, registrations): Result.Result<readonly Decided<SignInClientEvent>[], Conflict> => {
    const { issuer, redirect_uri, client_id, secret_id, replacing } = registering;
    return latestOf(registrations, placeOf(registering))?.client_id === replacing
      ? Result.succeed([{ type: 'sign_in_client_registered', data: { issuer, redirect_uri, client_id, secret_id } }])
      : Result.fail(
          new Conflict({
            kind: 'concurrent_change',
            detail: `Another client was registered with ${issuer} for ${redirect_uri} since this one was asked for`,
          }),
        );
  },
  context: ({ by, at }): Context => ({ by, at }),
  eventSchema: SignInClientEventSchema,
};

const SealedRegistration = Schema.fromJsonString(
  Schema.Struct({
    client_id: Schema.String,
    client_secret: Schema.String,
    token_endpoint_auth_method: Schema.Literals(clientAuthenticationMethods),
    client_secret_expires_at: Schema.Number,
  }),
);

const sealed = Schema.encodeSync(SealedRegistration);

const unsealed = Schema.decodeUnknownSync(SealedRegistration);

export class SignInClientUnavailable extends Data.TaggedError('SignInClientUnavailable')<{
  readonly message: string;
}> {}

export interface RegistrationServices {
  readonly registry: StreamReader & StreamWriter;
  readonly secrets: Pick<SecretStore, 'keep' | 'read' | 'forget'>;
  readonly by?: string;
}

export interface Kept {
  readonly inUse: RegisteredClient;
  readonly recordedFirstElsewhere: boolean;
}

interface Worded {
  readonly detail: string;
}

function unavailable({ issuer }: RegistrationPlace, clientId: string, doing: string, { detail }: Worded) {
  return new SignInClientUnavailable({
    message: `The client ${clientId} registered with the identity provider at ${issuer} cannot be ${doing} in the secret store now: ${detail}`,
  });
}

function registrationsOf({ registry }: RegistrationServices): Effect.Effect<Registrations> {
  return Effect.map(registry.load(signInClientRegistrationsStream, signInClientsDecider), ({ state }) => state);
}

export function latestClientAt(
  services: RegistrationServices,
  place: RegistrationPlace,
): Effect.Effect<string | undefined> {
  return Effect.map(registrationsOf(services), (registrations) => latestOf(registrations, place)?.client_id);
}

function registrationIn(stored: { readonly value: Redacted.Redacted } | undefined): RegisteredClient | undefined {
  if (stored === undefined) {
    return undefined;
  }
  const fields = unsealed(Redacted.value(stored.value));
  return {
    clientId: fields.client_id,
    clientSecret: Redacted.make(fields.client_secret),
    tokenEndpointAuthMethod: fields.token_endpoint_auth_method,
    secretExpiresAt: fields.client_secret_expires_at,
  };
}

export function namedClientAt(
  services: RegistrationServices,
  place: RegistrationPlace,
  clientId: string,
): Effect.Effect<RegisteredClient | undefined, SignInClientUnavailable> {
  return Effect.flatMap(registrationsOf(services), (registrations) => {
    const named = registrations.findLast(
      (registered) =>
        registered.client_id === clientId &&
        registered.issuer === place.issuer &&
        registered.redirect_uri === place.redirectUri,
    );
    return named === undefined
      ? Effect.undefined
      : services.secrets.read(named.secret_id).pipe(
          Effect.map(registrationIn),
          Effect.catchTag('secret_key_unknown', () => Effect.undefined),
          Effect.mapError((failure: Worded) => unavailable(place, clientId, 'read', failure)),
        );
  });
}

function sealedOf({ clientId, clientSecret, tokenEndpointAuthMethod, secretExpiresAt }: RegisteredClient) {
  return Redacted.make(
    sealed({
      client_id: clientId,
      client_secret: Redacted.value(clientSecret),
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      client_secret_expires_at: secretExpiresAt,
    }),
  );
}

function recordedFirstElsewhere(
  services: RegistrationServices,
  place: RegistrationPlace,
  secretId: string,
): Effect.Effect<Kept, SignInClientUnavailable> {
  return Effect.gen(function* () {
    yield* services.secrets.forget(secretId);
    const latest = String(yield* latestClientAt(services, place));
    const inUse = yield* namedClientAt(services, place, latest);
    return inUse === undefined
      ? yield* Effect.fail(unavailable(place, latest, 'read', { detail: 'it is no longer kept there' }))
      : { inUse, recordedFirstElsewhere: true };
  });
}

export function keptClientAt(
  services: RegistrationServices,
  place: RegistrationPlace,
  client: RegisteredClient,
  replacing?: string,
): Effect.Effect<Kept, SignInClientUnavailable> {
  return Effect.gen(function* () {
    const secretId = yield* Effect.mapError(services.secrets.keep(sealedOf(client)), (failure: Worded) =>
      unavailable(place, client.clientId, 'kept', failure),
    );
    const at = DateTime.formatIso(yield* DateTime.now);
    const registering: Registering = {
      issuer: place.issuer,
      redirect_uri: place.redirectUri,
      client_id: client.clientId,
      secret_id: secretId,
      replacing,
      by: services.by ?? byTheRuntime,
      at,
    };
    return yield* services.registry.execute(signInClientRegistrationsStream, signInClientsDecider, registering).pipe(
      Effect.as<Kept>({ inUse: client, recordedFirstElsewhere: false }),
      Effect.catch(() => recordedFirstElsewhere(services, place, secretId)),
    );
  });
}

export interface SignInClientRegistrations {
  readonly latestAt: (place: RegistrationPlace) => Promise<string | undefined>;
  readonly named: (place: RegistrationPlace, clientId: string) => Promise<RegisteredClient | undefined>;
  readonly kept: (place: RegistrationPlace, client: RegisteredClient, replacing: string | undefined) => Promise<Kept>;
}

function signInClientRegistrationsOf(services: RegistrationServices): SignInClientRegistrations {
  return {
    latestAt: (place) => Effect.runPromise(latestClientAt(services, place)),
    named: (place, clientId) => Effect.runPromise(namedClientAt(services, place, clientId)),
    kept: (place, client, replacing) => Effect.runPromise(keptClientAt(services, place, client, replacing)),
  };
}

export function clientRegistrationsIn(
  runtime: AppRuntime<DispatcherServices>,
): (secrets: RegistrationServices['secrets'], by?: string) => SignInClientRegistrations {
  return (secrets, by) =>
    signInClientRegistrationsOf({ registry: runtimeLedger(runtime), secrets, ...(by === undefined ? {} : { by }) });
}
