import type { ClientSource } from '@on.auto/tool-servers';

import type {
  ClientGiven,
  ConnectionAdded,
  ConnectionBroken,
  ConnectionConnected,
  ConsentStarted,
  LinkIssued,
  RecordedConnectionEvent,
} from './connection-events.ts';
import { scopesAddedTo, scopesSaid, wordsOf, type RecordedConnection } from './connection.ts';
import type { Credential } from './credential.ts';

export interface OpenLink {
  readonly token_sha256: string;
  readonly expires_at: string;
  readonly more?: string;
}

export interface StartedConsent {
  readonly state_sha256: string;
  readonly verifier_secret_id: string;
  readonly client_id: string;
  readonly client_source: ClientSource;
  readonly scope: string | undefined;
  readonly started_at: string;
  readonly expires_at: string;
}

export interface GivenClient {
  readonly client_id: string;
  readonly secret_id: string;
}

export interface KeptConnection {
  readonly connection: RecordedConnection;
  readonly link: OpenLink | undefined;
  readonly replacedLinks: ReadonlySet<string>;
  readonly consent: StartedConsent | undefined;
  readonly secretId: string | undefined;
  readonly algorithm: string | undefined;
  readonly clientSecretId: string | undefined;
  readonly nextClient: GivenClient | undefined;
}

export type Registry = ReadonlyMap<string, KeptConnection>;

export const initialRegistry: Registry = new Map();

function addedConnection({ data, context }: ConnectionAdded): KeptConnection {
  const { connection: id, name, server_type: type, provider, placeholders, entry, credential, says, added_by } = data;
  return {
    connection: {
      id,
      name,
      type,
      provider,
      placeholders,
      entry,
      credential,
      status: 'pending',
      added_by,
      added_at: context.at,
      connected_at: null,
      connected_by: null,
      asked_scopes: scopesSaid(credential.scope, says),
      granted_scope: null,
      granted_scopes: null,
      broken: null,
    },
    link: undefined,
    replacedLinks: new Set(),
    consent: undefined,
    secretId: undefined,
    algorithm: undefined,
    clientSecretId: undefined,
    nextClient: undefined,
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
  const { state_sha256, verifier_secret_id, client_id, client_source, expires_at, says } = data;
  const scope = data.scope ?? connection.credential.scope;
  return {
    ...kept,
    connection: { ...connection, asked_scopes: scopesAddedTo(connection.asked_scopes, scope, says) },
    consent: { state_sha256, verifier_secret_id, client_id, client_source, scope, started_at: context.at, expires_at },
  };
}

function replacedLinksOf({ link, replacedLinks }: KeptConnection): ReadonlySet<string> {
  return link === undefined ? replacedLinks : new Set(replacedLinks).add(link.token_sha256);
}

function withLink(kept: KeptConnection, { data }: LinkIssued): KeptConnection {
  const { token_sha256: tokenSha256, expires_at: expiresAt, more } = data;
  return {
    ...kept,
    link: { token_sha256: tokenSha256, expires_at: expiresAt, ...(more === undefined ? {} : { more }) },
    replacedLinks: replacedLinksOf(kept),
  };
}

function credentialOf({ connection }: KeptConnection, { data }: ConnectionConnected): Credential {
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
  return {
    connection: {
      ...kept.connection,
      credential: credentialOf(kept, event),
      status: 'connected',
      connected_at: context.at,
      connected_by: data.connected_by,
      granted_scope: data.scope ?? null,
      granted_scopes: data.scope === undefined ? null : scopesSaid(data.scope, wordsOf(kept.connection.asked_scopes)),
      broken: null,
    },
    link: undefined,
    replacedLinks: kept.replacedLinks,
    consent: undefined,
    secretId: data.secret_id,
    algorithm: data.algorithm,
    clientSecretId: promoted === undefined ? kept.clientSecretId : promoted.secret_id,
    nextClient: promoted === undefined ? kept.nextClient : undefined,
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
  return { ...kept, connection: { ...kept.connection, status: 'removed', broken: null }, link: undefined };
}

function evolvedConnection(
  kept: KeptConnection,
  event: Exclude<RecordedConnectionEvent, ConnectionAdded>,
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
  if (event.type === 'connection_approved') {
    return kept;
  }
  if (event.type === 'connection_connected') {
    return connected(kept, event);
  }
  return event.type === 'connection_broken' ? broken(kept, event) : removed(kept);
}

function withConnection(registry: Registry, kept: KeptConnection): Registry {
  return new Map(registry).set(kept.connection.id, kept);
}

export function evolveRegistry(registry: Registry, event: RecordedConnectionEvent): Registry {
  if (event.type === 'connection_added') {
    return withConnection(registry, addedConnection(event));
  }
  const kept = registry.get(event.data.connection);
  return kept === undefined ? registry : withConnection(registry, evolvedConnection(kept, event));
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

export function clientSecretsHeldBy({ clientSecretId, nextClient }: KeptConnection): readonly string[] {
  return [clientSecretId, nextClient?.secret_id].filter((secretId) => secretId !== undefined);
}

export function clientSecretsReleasedOf(before: KeptConnection, after: KeptConnection): readonly string[] {
  const held = new Set(clientSecretsHeldBy(after));
  return clientSecretsHeldBy(before).filter((secretId) => !held.has(secretId));
}

export function newestFirst(registry: Registry): readonly KeptConnection[] {
  return [...registry.values()].toReversed();
}
