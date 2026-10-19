import type { StreamReader, StreamWriter } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import type { Redacted } from 'effect';

import type { ConnectPages } from '../links/connect-page.ts';
import type { SecretKeeping } from '../operations/connection-services.ts';
import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import type { KeptConnection } from '../registry/registry.ts';

export interface ServingServices {
  readonly registry: StreamReader & StreamWriter;
  readonly secrets: Pick<SecretKeeping, 'read' | 'replace' | 'claim'>;
  readonly policy: ConnectionPolicy;
  readonly pages: ConnectPages;
  readonly variables: ReadonlyMap<string, Redacted.Redacted>;
  readonly modelProviders: readonly string[];
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
}

export interface Serving {
  readonly org: string;
  readonly kept: KeptConnection;
  readonly services: ServingServices;
}
