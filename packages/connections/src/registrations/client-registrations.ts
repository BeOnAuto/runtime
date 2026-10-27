import {
  ActedContextSchema,
  factOf,
  type Context,
  type Decider,
  type Decided,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import type {
  ClientRegistrations,
  KeptRegistration,
  RegistrationPlace,
  RegistrationUnavailable,
} from '@on.auto/tool-servers';
import { DateTime, Effect, Result, Schema } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import type { CommandMetadata } from '../registry/connection-commands.ts';
import { byTheRuntime } from '../registry/registry-decider.ts';

export const clientRegistrationsStream = 'runtime/client-registrations';

const RegistrationEventSchema = Schema.Union([
  factOf(
    'client_registered',
    Schema.Struct({
      issuer: Schema.String,
      server: Schema.NullOr(Schema.String),
      client_id: Schema.String,
      secret_id: Schema.String,
    }),
    ActedContextSchema,
  ),
]);

type RegistrationEvent = typeof RegistrationEventSchema.Type;

interface Registering extends CommandMetadata, RegistrationPlace {
  readonly client_id: string;
  readonly secret_id: string;
}

interface Registered {
  readonly secretId: string;
  readonly server: string | null;
}

type Registrations = ReadonlyMap<string, ReadonlyMap<string, Registered>>;

const noRegistrations: Registrations = new Map();

const noClients: ReadonlyMap<string, Registered> = new Map();

function evolveRegistrations(registrations: Registrations, { data }: RegistrationEvent): Registrations {
  const { issuer, server, client_id: clientId, secret_id: secretId } = data;
  const atTheIssuer = new Map(registrations.get(issuer) ?? []);
  atTheIssuer.delete(clientId);
  return new Map(registrations).set(issuer, atTheIssuer.set(clientId, { secretId, server }));
}

const registrationsDecider: Decider<Registrations, Registering, RegistrationEvent> = {
  initialState: noRegistrations,
  evolve: evolveRegistrations,
  decide: ({ issuer, server, client_id, secret_id }): Result.Result<readonly Decided<RegistrationEvent>[]> =>
    Result.succeed([{ type: 'client_registered', data: { issuer, server, client_id, secret_id } }]),
  context: ({ by, at }): Context => ({ by, at }),
  eventSchema: RegistrationEventSchema,
};

export interface RegistrationServices {
  readonly registry: StreamReader & StreamWriter;
  readonly secrets: SecretKeeping;
}

function keptOf(
  { secrets }: RegistrationServices,
  clientId: string,
  secretId: string,
): Effect.Effect<KeptRegistration | undefined, RegistrationUnavailable> {
  return Effect.map(secrets.read(secretId), (stored) =>
    stored === undefined ? undefined : { clientId, registration: stored.value },
  );
}

function registrationsAt(
  { registry }: RegistrationServices,
  issuer: string,
): Effect.Effect<ReadonlyMap<string, Registered>> {
  return Effect.map(
    registry.load(clientRegistrationsStream, registrationsDecider),
    ({ state }) => state.get(issuer) ?? noClients,
  );
}

export function makeClientRegistrations(services: RegistrationServices): ClientRegistrations {
  return {
    latestAt: ({ issuer, server }) =>
      Effect.flatMap(registrationsAt(services, issuer), (atTheIssuer) => {
        const latest = [...atTheIssuer].findLast(
          ([, registered]: readonly [string, Registered]) => registered.server === server,
        );
        return latest === undefined ? Effect.undefined : keptOf(services, latest[0], latest[1].secretId);
      }),
    named: (issuer, clientId) =>
      Effect.flatMap(registrationsAt(services, issuer), (atTheIssuer) => {
        const registered = atTheIssuer.get(clientId);
        return registered === undefined ? Effect.undefined : keptOf(services, clientId, registered.secretId);
      }),
    keep: ({ issuer, server }, { clientId, registration }) =>
      Effect.gen(function* () {
        const secretId = yield* services.secrets.keep(registration);
        const at = DateTime.formatIso(yield* DateTime.now);
        const registering = { issuer, server, client_id: clientId, secret_id: secretId, by: byTheRuntime, at };
        yield* Effect.orDie(services.registry.execute(clientRegistrationsStream, registrationsDecider, registering));
      }),
  };
}
