import type { CallingClient } from '@on.auto/operations';

import type {
  ClientGiven,
  ConnectionAdded,
  ConnectionBroken,
  ConnectionConnected,
  ConsentStarted,
  LinkIssued,
  NextWayChosen,
  RecordedConnectionEvent,
} from './connection-events.ts';
import { scopesAddedTo, scopesSaid, withItsInstallation, wordsOf, type RecordedConnection } from './connection.ts';
import { appCredentialsHeldOf, type AppSecretIds } from './kept-app-credentials.ts';
import { evolvedWithItsNextWay, type NextWay } from './kept-next-ways.ts';
import { isKeptRead, keptReadAfter, noReads, type KeptReads } from './kept-reads.ts';
import { changesNothingButItsRequest, requestedAfter } from './kept-requests.ts';
import { withoutItsServiceAccount, type KeptServiceAccount } from './kept-service-accounts.ts';
import { isASetting, settingAfter } from './kept-settings.ts';
import { isOfItsKeptValues, withItsKeptValues } from './kept-values.ts';

export interface OpenLink {
  readonly token_sha256: string;
  readonly more?: string;
  readonly asked_by?: CallingClient;
}

export interface StartedConsent {
  readonly state_sha256: string;
  readonly verifier_secret_id: string;
  readonly client_id: string;
  readonly client_source: ConsentStarted['data']['client_source'];
  readonly scope: string | undefined;
  readonly started_at: string;
  readonly expires_at: string;
  readonly playbooks: readonly string[] | null | undefined;
}

export interface GivenClient {
  readonly client_id: string;
  readonly secret_id: string;
}

export interface KeptConnection extends KeptReads, KeptServiceAccount {
  readonly connection: RecordedConnection;
  readonly ways: readonly RecordedConnection['credential'][] | undefined;
  readonly link: OpenLink | undefined;
  readonly replacedLinks: ReadonlySet<string>;
  readonly consent: StartedConsent | undefined;
  readonly secretId: string | undefined;
  readonly algorithm: string | undefined;
  readonly clientSecretId: string | undefined;
  readonly nextClient: GivenClient | undefined;
  readonly signing: Parameters<typeof withItsKeptValues>[0]['signing'];
  readonly appSecretIds: AppSecretIds;
  readonly model: string | null;
  readonly nextWay: NextWay | undefined;
}

export type Registry = ReadonlyMap<string, KeptConnection>;

export const initialRegistry: Registry = new Map();

function addedConnection({ data, context }: ConnectionAdded): KeptConnection {
  const { connection: id, name, server_type: type, provider, placeholders, entry, credential, says, added_by } = data;
  const { document, events, account_type: accountType, ways } = data;
  return {
    connection: {
      id,
      name,
      type,
      provider,
      placeholders,
      entry,
      ...(document === undefined ? {} : { document }),
      ...(events === undefined ? {} : { events }),
      credential,
      account_type: accountType ?? null,
      status: 'pending',
      added_by,
      added_at: context.at,
      request: null,
      connected_at: null,
      connected_by: null,
      asked_scopes: scopesSaid(credential.scope, says),
      granted_scope: null,
      granted_scopes: null,
      broken: null,
      signing_secret: null,
      account: null,
      app_credentials: [],
    },
    ways,
    link: undefined,
    replacedLinks: new Set(),
    consent: undefined,
    secretId: undefined,
    algorithm: undefined,
    clientSecretId: undefined,
    nextClient: undefined,
    signing: undefined,
    appSecretIds: {},
    model: null,
    nextWay: undefined,
    ...noReads,
    serviceAccount: undefined,
  };
}

function isTheNextClient({ connection, secretId }: KeptConnection, given: GivenClient): boolean {
  return secretId !== undefined && given.client_id !== connection.credential.client_id;
}

function withClient(kept: KeptConnection, { data }: ClientGiven): KeptConnection {
  const given = { client_id: data.client_id, secret_id: data.secret_id };
  if (isTheNextClient(kept, given)) {
    return { ...kept, nextClient: given };
  }
  const { connection } = kept;
  return {
    ...kept,
    connection: { ...connection, credential: { ...connection.credential, client_id: given.client_id } },
    clientSecretId: given.secret_id,
    nextClient: undefined,
  };
}

function withConsent({ connection, ...kept }: KeptConnection, { data, context }: ConsentStarted): KeptConnection {
  const { state_sha256, verifier_secret_id, client_id, client_source, expires_at, says, playbooks } = data;
  const scope = data.scope ?? connection.credential.scope;
  return {
    ...kept,
    connection: { ...connection, asked_scopes: scopesAddedTo(connection.asked_scopes, scope, says) },
    consent: {
      state_sha256,
      verifier_secret_id,
      client_id,
      client_source,
      scope,
      started_at: context.at,
      expires_at,
      playbooks,
    },
  };
}

function replacedLinksOf({ link, replacedLinks }: KeptConnection): ReadonlySet<string> {
  return link === undefined ? replacedLinks : new Set(replacedLinks).add(link.token_sha256);
}

function withLink(kept: KeptConnection, { data }: LinkIssued): KeptConnection {
  const { token_sha256: tokenSha256, more, asked_by: askedBy } = data;
  return {
    ...kept,
    link: {
      token_sha256: tokenSha256,
      ...(more === undefined ? {} : { more }),
      ...(askedBy === undefined ? {} : { asked_by: askedBy }),
    },
    replacedLinks: replacedLinksOf(kept),
  };
}

function credentialOf({ connection }: KeptConnection, { data }: ConnectionConnected): RecordedConnection['credential'] {
  const { client_id: clientId, client_source: clientSource } = data;
  return {
    ...connection.credential,
    ...(clientId === undefined ? {} : { client_id: clientId }),
    ...(clientSource === undefined ? {} : { client_source: clientSource }),
  };
}

function promotedOf({ nextClient }: KeptConnection, { data }: ConnectionConnected): GivenClient | undefined {
  return nextClient?.client_id === data.client_id ? nextClient : undefined;
}

function connected(kept: KeptConnection, event: ConnectionConnected): KeptConnection {
  const { data, context } = event;
  const promoted = promotedOf(kept, event);
  const appSecretIds = data.app_secret_ids ?? {};
  return {
    connection: {
      ...withItsInstallation(kept.connection, data.installation),
      credential: credentialOf(kept, event),
      status: 'connected',
      connected_at: context.at,
      connected_by: data.connected_by,
      granted_scope: data.scope ?? null,
      granted_scopes: data.scope === undefined ? null : scopesSaid(data.scope, wordsOf(kept.connection.asked_scopes)),
      broken: null,
      account: data.account ?? null,
      app_credentials: appCredentialsHeldOf(appSecretIds),
    },
    ways: kept.ways,
    link: undefined,
    replacedLinks: kept.replacedLinks,
    consent: undefined,
    secretId: data.secret_id,
    algorithm: data.algorithm,
    clientSecretId: promoted === undefined ? kept.clientSecretId : promoted.secret_id,
    nextClient: promoted === undefined ? kept.nextClient : undefined,
    signing: kept.signing,
    appSecretIds,
    model: kept.model,
    nextWay: kept.nextWay,
    ...noReads,
    serviceAccount: kept.serviceAccount,
  };
}

function broken(kept: KeptConnection, { data, context }: ConnectionBroken): KeptConnection {
  const { kind, reason } = data;
  return {
    ...kept,
    connection: { ...kept.connection, status: 'broken', broken: { kind, detail: reason, at: context.at } },
  };
}

function removed(kept: KeptConnection): KeptConnection {
  const { connection, ...without } = withoutItsServiceAccount(kept);
  return {
    ...without,
    connection: { ...connection, status: 'removed', broken: null, signing_secret: null, app_credentials: [] },
    link: undefined,
  };
}

function evolvedOnItsWay(
  kept: KeptConnection,
  event: Exclude<RecordedConnectionEvent, ConnectionAdded | NextWayChosen>,
): KeptConnection {
  if (event.type === 'connection_link_issued') {
    return withLink(kept, event);
  }
  if (event.type === 'connection_client_given') {
    return withClient(kept, event);
  }
  if (event.type === 'connection_consent_started') {
    return withConsent(kept, event);
  }
  if (changesNothingButItsRequest(event)) {
    return kept;
  }
  if (event.type === 'connection_connected') {
    return connected(kept, event);
  }
  if (isASetting(event)) {
    return settingAfter(kept, event);
  }
  if (isKeptRead(event)) {
    return keptReadAfter(kept, event);
  }
  if (isOfItsKeptValues(event)) {
    return withItsKeptValues(kept, event);
  }
  return event.type === 'connection_broken' ? broken(kept, event) : removed(kept);
}

const evolvedConnection = evolvedWithItsNextWay(evolvedOnItsWay);

function withConnection(registry: Registry, kept: KeptConnection): Registry {
  return new Map(registry).set(kept.connection.id, kept);
}

export function evolveRegistry(registry: Registry, event: RecordedConnectionEvent): Registry {
  if (event.type === 'connection_added') {
    return withConnection(registry, addedConnection(event));
  }
  const kept = registry.get(event.data.connection);
  return kept === undefined
    ? registry
    : withConnection(registry, requestedAfter(evolvedConnection(kept, event), event));
}

export function heldClientOf({ connection, clientSecretId }: KeptConnection): GivenClient | undefined {
  const clientId = connection.credential.client_id;
  return clientId === undefined || clientSecretId === undefined
    ? undefined
    : { client_id: clientId, secret_id: clientSecretId };
}

export function signingInClientOf(kept: KeptConnection): GivenClient | undefined {
  return kept.nextClient ?? heldClientOf(kept);
}

export function clientSecretsHeldBy({ clientSecretId, nextClient, nextWay }: KeptConnection): readonly string[] {
  const held = [clientSecretId, nextClient?.secret_id, nextWay?.clientSecretId];
  return [...new Set(held.filter((secretId) => secretId !== undefined))];
}

export function clientSecretsReleasedOf(before: KeptConnection, after: KeptConnection): readonly string[] {
  const held = new Set(clientSecretsHeldBy(after));
  return clientSecretsHeldBy(before).filter((secretId) => !held.has(secretId));
}

export function newestFirst(registry: Registry): readonly KeptConnection[] {
  return [...registry.values()].toReversed();
}
