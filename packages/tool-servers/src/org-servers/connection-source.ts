import { Effect, Schema } from 'effect';

import type { McpServerSettings, OpenApiServerSettings, ServerSettings } from '../settings/server-settings.ts';

export type ConnectionServerSettings = McpServerSettings | OpenApiServerSettings;

export function isConnectionServerSettings(settings: ServerSettings): settings is ConnectionServerSettings {
  return settings.type !== 'stdio';
}

export type ConnectionServing = Pick<
  ConnectionServerSettings,
  'name' | 'type' | 'orgs' | 'playbooks' | 'allowed' | 'record_content' | 'request_id' | 'provider'
>;

export const unreadyReasons = [
  'connection_pending',
  'connection_broken',
  'connection_not_allowed',
  'connection_unavailable',
] as const;

const UnreadyBecauseSchema = Schema.Literals(unreadyReasons);

export type UnreadyBecause = typeof UnreadyBecauseSchema.Type;

export const isUnready: (because: string) => because is UnreadyBecause = Schema.is(UnreadyBecauseSchema);

export interface ConnectionUnready {
  readonly because: UnreadyBecause;
  readonly detail: string;
}

export interface ConnectionServer {
  readonly settings: ConnectionServerSettings;
  readonly reaches: (url: string) => string | undefined;
}

export type ConnectionState =
  | { readonly status: 'connected'; readonly server: Effect.Effect<ConnectionServer, ConnectionUnready> }
  | { readonly status: 'unready'; readonly unready: ConnectionUnready };

export interface OrgConnection {
  readonly id: string;
  readonly serving: ConnectionServing;
  readonly state: ConnectionState;
}

export interface ConnectionSource {
  readonly takesConnections: boolean;
  readonly connectionsOf: (org: string) => Effect.Effect<readonly OrgConnection[]>;
}

export const noConnections: ConnectionSource = {
  takesConnections: false,
  connectionsOf: () => Effect.succeed([]),
};
