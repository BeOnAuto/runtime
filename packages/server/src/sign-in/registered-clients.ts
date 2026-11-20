import {
  isLastingAt,
  type RegisteredClient,
  type RegisteringProvider,
  type RelyingPartyClients,
} from '@on.auto/openid-connect';

import type { ClientsReport } from '../logging/sign-in-logging.ts';
import type { RegistrationPlace, SignInClientRegistrations } from './client-registrations.ts';

interface Remembered {
  get(clientId: string): RegisteredClient | undefined;
  remember(client: RegisteredClient): RegisteredClient;
}

interface SingleFlight {
  once(registered: () => Promise<RegisteredClient>): Promise<RegisteredClient>;
}

interface Clients {
  readonly provider: Pick<RegisteringProvider, 'registered'>;
  readonly place: RegistrationPlace;
  readonly registrations: SignInClientRegistrations;
  readonly report: ClientsReport;
  readonly remembered: Remembered;
  readonly flight: SingleFlight;
}

function rememberedClients(): Remembered {
  const kept = new Map<string, RegisteredClient>();
  return {
    get: (clientId) => kept.get(clientId),
    remember: (client) => {
      kept.set(client.clientId, client);
      return client;
    },
  };
}

function singleFlight(): SingleFlight {
  const flying: { registering?: Promise<RegisteredClient> } = {};
  return {
    once: (registered) => {
      const registering =
        flying.registering ??
        registered().finally(() => {
          delete flying.registering;
        });
      flying.registering = registering;
      return registering;
    },
  };
}

async function named({ place, registrations, remembered }: Clients, clientId: string) {
  const client = remembered.get(clientId) ?? (await registrations.named(place, clientId));
  return client === undefined ? client : remembered.remember(client);
}

export interface KeptInPlace {
  readonly inUse: RegisteredClient;
  readonly registered: RegisteredClient;
  readonly recordedFirstElsewhere: boolean;
  readonly replacing: string | undefined;
}

async function keptInPlaceOf(
  { provider, place, registrations }: Pick<Clients, 'provider' | 'place' | 'registrations'>,
  replacing: string | undefined,
): Promise<KeptInPlace> {
  const registered = await provider.registered();
  const { inUse, recordedFirstElsewhere } = await registrations.kept(place, registered, replacing);
  return { inUse, registered, recordedFirstElsewhere, replacing };
}

async function registeredInPlaceOf(clients: Clients, replacing: string | undefined): Promise<RegisteredClient> {
  const { report, remembered } = clients;
  const { inUse, registered, recordedFirstElsewhere } = await keptInPlaceOf(clients, replacing);
  if (recordedFirstElsewhere) {
    report.registeredElsewhereFirst(inUse.clientId, registered.clientId);
  } else {
    report.registered(inUse.clientId, replacing);
  }
  return remembered.remember(inUse);
}

export async function registeredAgain(
  provider: Pick<RegisteringProvider, 'issuer' | 'redirectUri' | 'registered'>,
  registrations: SignInClientRegistrations,
): Promise<KeptInPlace> {
  const place = { issuer: provider.issuer, redirectUri: provider.redirectUri };
  return keptInPlaceOf({ provider, place, registrations }, await registrations.latestAt(place));
}

function registeredOnce(clients: Clients, replacing: string | undefined): Promise<RegisteredClient> {
  return clients.flight.once(() => registeredInPlaceOf(clients, replacing));
}

async function clientInUse(clients: Clients): Promise<RegisteredClient> {
  const latest = await clients.registrations.latestAt(clients.place);
  const client = latest === undefined ? latest : await named(clients, latest);
  return client !== undefined && isLastingAt(client, Date.now()) ? client : registeredOnce(clients, latest);
}

async function refused(clients: Clients, clientId: string): Promise<void> {
  if ((await clients.registrations.latestAt(clients.place)) !== clientId) {
    return;
  }
  await registeredOnce(clients, clientId).catch((failure: unknown) => {
    clients.report.notRegistered(String(Reflect.get(new Object(failure), 'message')));
  });
}

export function registeredClientsOf(
  provider: Pick<RegisteringProvider, 'issuer' | 'redirectUri' | 'registered'>,
  registrations: SignInClientRegistrations,
  report: ClientsReport,
): RelyingPartyClients {
  const clients: Clients = {
    provider,
    place: { issuer: provider.issuer, redirectUri: provider.redirectUri },
    registrations,
    report,
    remembered: rememberedClients(),
    flight: singleFlight(),
  };
  return {
    inUse: () => clientInUse(clients),
    named: (clientId) => named(clients, clientId),
    refused: ({ clientId }) => refused(clients, clientId),
  };
}
