import {
  ActedContextSchema,
  factOf,
  type Context,
  type Decider,
  type Decided,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import type { ClientRegistrations, KeptRegistration, RegistrationUnavailable } from '@on.auto/tool-servers';
import { DateTime, Effect, Result, Schema } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import type { CommandMetadata } from '../registry/connection-commands.ts';
import { byTheRuntime } from '../registry/registry-decider.ts';

export const clientRegistrationsStream = 'runtime/client-registrations';

const RegistrationEventSchema = Schema.Union([
  factOf(
    'client_registered',
    Schema.Struct({ issuer: Schema.String, client_id: Schema.String, secret_id: Schema.String }),
    ActedContextSchema,
  ),
]);

type RegistrationEvent = typeof RegistrationEventSchema.Type;

interface Registering extends CommandMetadata {
  readonly issuer: string;
  readonly client_id: string;
  readonly secret_id: string;
}

type Registrations = ReadonlyMap<string, ReadonlyMap<string, string>>;

const noRegistrations: Registrations = new Map();

const noClients: ReadonlyMap<string, string> = new Map();

function evolveRegistrations(registrations: Registrations, { data }: RegistrationEvent): Registrations {
  const { issuer, client_id: clientId, secret_id: secretId } = data;
  const atTheIssuer = new Map(registrations.get(issuer) ?? []);
  atTheIssuer.delete(clientId);
  return new Map(registrations).set(issuer, atTheIssuer.set(clientId, secretId));
}

const registrationsDecider: Decider<Registrations, Registering, RegistrationEvent> = {
  initialState: noRegistrations,
  evolve: evolveRegistrations,
  decide: ({ issuer, client_id, secret_id }): Result.Result<readonly Decided<RegistrationEvent>[]> =>
    Result.succeed([{ type: 'client_registered', data: { issuer, client_id, secret_id } }]),
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
): Effect.Effect<ReadonlyMap<string, string> | undefined> {
  return Effect.map(registry.load(clientRegistrationsStream, registrationsDecider), ({ state }) => state.get(issuer));
}

export function makeClientRegistrations(services: RegistrationServices): ClientRegistrations {
  return {
    latestAt: (issuer) =>
      Effect.flatMap(registrationsAt(services, issuer), (atTheIssuer) => {
        const latest = [...(atTheIssuer ?? noClients)].at(-1);
        return latest === undefined ? Effect.undefined : keptOf(services, latest[0], latest[1]);
      }),
    named: (issuer, clientId) =>
      Effect.flatMap(registrationsAt(services, issuer), (atTheIssuer) => {
        const secretId = atTheIssuer?.get(clientId);
        return secretId === undefined ? Effect.undefined : keptOf(services, clientId, secretId);
      }),
    keep: (issuer, { clientId, registration }) =>
      Effect.gen(function* () {
        const secretId = yield* services.secrets.keep(registration);
        const at = DateTime.formatIso(yield* DateTime.now);
        const registering = { issuer, client_id: clientId, secret_id: secretId, by: byTheRuntime, at };
        yield* Effect.orDie(services.registry.execute(clientRegistrationsStream, registrationsDecider, registering));
      }),
  };
}
