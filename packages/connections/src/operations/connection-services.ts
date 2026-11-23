import type { Resolve } from '@on.auto/outbound';
import type { ProviderList } from '@on.auto/providers';
import type {
  ConsentClient,
  KeptRow,
  ReadOnceThrough,
  SecretKeepingFailure,
  SecretReadingFailure,
  TokensClaimed,
  TokensReplaced,
} from '@on.auto/tool-servers';
import type { Effect, Redacted } from 'effect';

import type { ConnectPages } from '../links/connect-page.ts';
import type { SocketChecks } from '../page/given-checks.ts';
import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import type { StartsOfConnections } from '../policy/connection-starts.ts';
import type { RuntimeAccess } from '../policy/policy-rules.ts';
import type { EventsReceived } from '../triggers/connection-hearing.ts';

export interface SecretKeeping {
  readonly keep: (value: Redacted.Redacted, endsWith?: string) => Effect.Effect<string, SecretKeepingFailure>;
  readonly read: (id: string) => Effect.Effect<KeptRow | undefined, SecretReadingFailure>;
  readonly replace: (
    id: string,
    version: number,
    value: Redacted.Redacted,
  ) => Effect.Effect<TokensReplaced, SecretKeepingFailure>;
  readonly claim: (id: string, version: number, lastingMs: number) => Effect.Effect<TokensClaimed>;
  readonly endingsOf: (ids: readonly string[]) => Effect.Effect<ReadonlyMap<string, string>>;
  readonly forget: (id: string) => Effect.Effect<void>;
}

interface RemovedConnection {
  readonly connection: string;
  readonly account: string | undefined;
}

export type ConnectionRemoved = (removed: RemovedConnection) => Effect.Effect<void>;

interface ChatThroughAGateway {
  readonly defaultModel: Effect.Effect<string>;
}

export interface ChatModels {
  readonly refusalOf: (model: string) => Effect.Effect<string | undefined>;
  readonly throughAGateway?: ChatThroughAGateway;
}

export interface ConnectionServices extends StartsOfConnections {
  readonly secrets: SecretKeeping;
  readonly policy: ConnectionPolicy;
  readonly fileEntries: readonly string[];
  readonly modelProviders: readonly string[];
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
  readonly variables: ReadonlyMap<string, Redacted.Redacted>;
  readonly pages: ConnectPages;
  readonly access: RuntimeAccess;
  readonly consent: ConsentClient;
  readonly resolve?: Resolve;
  readonly fetch: typeof globalThis.fetch;
  readonly readOnceThrough: ReadOnceThrough;
  readonly sockets?: SocketChecks;
  readonly chatModels?: ChatModels;
  readonly connectionRemoved?: ConnectionRemoved;
  readonly received?: EventsReceived;
}

export function opensSockets({ sockets }: Pick<ConnectionServices, 'sockets'>): boolean {
  return sockets !== undefined;
}
