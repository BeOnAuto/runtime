import type { StreamReader, StreamWriter } from '@on.auto/operations';
import { providerFoundBy, type EventDestination, type ProviderEntry, type ProviderList } from '@on.auto/providers';
import { DateTime, Effect } from 'effect';

import type { RecordedConnection } from '../registry/connection.ts';
import {
  byTheRuntime,
  connectionsFoldOf,
  connectionsStreamOfOrg,
  registryDeciderOf,
} from '../registry/registry-decider.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { identityOwedBy } from '../subscriptions/owed-identities.ts';

export interface SocketHolder {
  readonly connection: string;
  readonly name: string;
  readonly connectedAt: string;
  readonly provider: string;
  readonly at: number;
  readonly destination: EventDestination;
  readonly credential: string;
  readonly label: string;
  readonly secretId: string;
  readonly failureCodes?: NonNullable<ProviderEntry['failure_codes']>;
  readonly account?: string;
  readonly accountName?: string;
  readonly identityOwed: boolean;
  readonly model: string | null;
}

export interface HeldSockets {
  readonly version: number;
  readonly holders: readonly SocketHolder[];
}

export interface SocketRegistries {
  readonly registry: Pick<StreamReader, 'load'> & Pick<StreamWriter, 'execute'>;
  readonly providers: ProviderList;
}

const socketWords = {
  appCredentialRefused: (label: string) =>
    `The provider refused the ${label} this connection holds, so replies are checked on a timer, not at once, and no workflow starts from its events. Reconnect the connection to give a new one.`,
  unrecorded: (name: string) => `The refusal of an app credential of the connection ${name} could not be recorded`,
} as const;

export function holdsItUnrefused({ app_credentials: held }: Pick<RecordedConnection, 'app_credentials'>, name: string) {
  return held.some((each) => each.name === name && each.refused === null);
}

function secretIdOf({ appSecretIds }: KeptConnection, credential: string): string | undefined {
  return Object.hasOwn(appSecretIds, credential) ? appSecretIds[credential] : undefined;
}

export function labelsOf({ credentials }: ProviderEntry, credential: string): readonly string[] {
  return credentials.flatMap(({ kind, app_credentials: declared = [] }) =>
    kind === 'secret' ? declared.filter(({ name }) => name === credential).map(({ description }) => description) : [],
  );
}

function namedOf({ name }: { readonly name?: string }): Pick<SocketHolder, 'accountName'> {
  return name === undefined ? {} : { accountName: name };
}

function holdersOf(kept: KeptConnection, providers: ProviderList): readonly SocketHolder[] {
  const { id, name, provider, status, connected_at: connectedAt, account } = kept.connection;
  const entry = providerFoundBy(providers, provider)?.entry;
  if (entry === undefined || status !== 'connected' || connectedAt === null) {
    return [];
  }
  const codes = entry.failure_codes === undefined ? {} : { failureCodes: entry.failure_codes };
  const recorded = account === null ? {} : { account: account.id, ...namedOf(account) };
  const identityOwed = identityOwedBy(providers, kept) !== undefined;
  return (entry.events?.destinations ?? []).flatMap((destination, at): readonly SocketHolder[] => {
    const { type, credential } = destination;
    const secretId = credential === undefined ? undefined : secretIdOf(kept, credential);
    const [label] = credential === undefined ? [] : labelsOf(entry, credential);
    return type === 'websocket' && credential !== undefined && secretId !== undefined && label !== undefined
      ? [
          {
            connection: id,
            name,
            connectedAt,
            provider: entry.name,
            at,
            destination,
            credential,
            label,
            secretId,
            ...codes,
            ...recorded,
            identityOwed,
            model: kept.model,
          },
        ]
      : [];
  });
}

export function socketsHeldIn({ registry, providers }: SocketRegistries, org: string): Effect.Effect<HeldSockets> {
  return Effect.map(registry.load(connectionsStreamOfOrg(org), connectionsFoldOf(providers)), ({ state, version }) => ({
    version,
    holders: [...state.values()].flatMap((kept) =>
      holdersOf(kept, providers).filter(({ credential }) => holdsItUnrefused(kept.connection, credential)),
    ),
  }));
}

export function appCredentialRefused(
  { registry, providers }: SocketRegistries,
  org: string,
  {
    connection,
    name,
    connectedAt,
    credential,
    label,
  }: Pick<SocketHolder, 'connection' | 'name' | 'connectedAt' | 'credential' | 'label'>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const refusing = {
      type: 'refuse_app_credential',
      connection,
      connected_at: connectedAt,
      name: credential,
      reason: socketWords.appCredentialRefused(label),
      by: byTheRuntime,
      at: DateTime.formatIso(yield* DateTime.now),
    } as const;
    yield* registry.execute(connectionsStreamOfOrg(org), registryDeciderOf(providers), refusing).pipe(
      Effect.orDie,
      Effect.catchCause((cause) => Effect.logError(socketWords.unrecorded(name), cause)),
    );
  });
}
