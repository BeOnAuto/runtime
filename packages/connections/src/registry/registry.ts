import type { ClientSource } from '@on.auto/tool-servers';

import type {
  ConnectionAdded,
  ConnectionBroken,
  ConnectionConnected,
  ConsentStarted,
  LinkIssued,
  RecordedConnectionEvent,
} from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';
import type { Credential } from './credential.ts';

export interface OpenLink {
  readonly token_sha256: string;
  readonly expires_at: string;
}

export interface StartedConsent {
  readonly state_sha256: string;
  readonly verifier_secret_id: string;
  readonly client_id: string;
  readonly client_source: ClientSource;
  readonly started_at: string;
  readonly expires_at: string;
}

export interface KeptConnection {
  readonly connection: RecordedConnection;
  readonly link: OpenLink | undefined;
  readonly consent: StartedConsent | undefined;
  readonly secretId: string | undefined;
  readonly algorithm: string | undefined;
}

export type Registry = ReadonlyMap<string, KeptConnection>;

export const initialRegistry: Registry = new Map();

function addedConnection({ data, context }: ConnectionAdded): KeptConnection {
  const { connection: id, name, server_type: type, provider, placeholders, entry, credential } = data;
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
      added_by: context.by,
      added_at: context.at,
      connected_at: null,
      connected_by: null,
      broken: null,
    },
    link: undefined,
    consent: undefined,
    secretId: undefined,
    algorithm: undefined,
  };
}

function withConsent(kept: KeptConnection, { data, context }: ConsentStarted): KeptConnection {
  const { state_sha256, verifier_secret_id, client_id, client_source, expires_at } = data;
  return {
    ...kept,
    consent: { state_sha256, verifier_secret_id, client_id, client_source, started_at: context.at, expires_at },
  };
}

function withLink(kept: KeptConnection, { data }: LinkIssued): KeptConnection {
  return { ...kept, link: { token_sha256: data.token_sha256, expires_at: data.expires_at } };
}

function credentialOf({ connection }: KeptConnection, { data }: ConnectionConnected): Credential {
  const { client_id: clientId, client_source: clientSource, scope } = data;
  return {
    ...connection.credential,
    ...(clientId === undefined ? {} : { client_id: clientId }),
    ...(clientSource === undefined ? {} : { client_source: clientSource }),
    ...(scope === undefined ? {} : { scope }),
  };
}

function connected(kept: KeptConnection, event: ConnectionConnected): KeptConnection {
  const { data, context } = event;
  return {
    connection: {
      ...kept.connection,
      credential: credentialOf(kept, event),
      status: 'connected',
      connected_at: context.at,
      connected_by: context.by,
      broken: null,
    },
    link: undefined,
    consent: undefined,
    secretId: data.secret_id,
    algorithm: data.algorithm,
  };
}

function broken(kept: KeptConnection, { data }: ConnectionBroken): KeptConnection {
  return { ...kept, connection: { ...kept.connection, status: 'broken', broken: data.reason } };
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

export function newestFirst(registry: Registry): readonly KeptConnection[] {
  return [...registry.values()].toReversed();
}
