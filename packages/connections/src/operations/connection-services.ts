import type { ProviderList } from '@on.auto/providers';
import type { ConsentClient } from '@on.auto/tool-servers';
import type { Effect, Redacted } from 'effect';

import type { ConnectPages } from '../links/connect-page.ts';
import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import type { RuntimeAccess } from '../policy/policy-rules.ts';

export interface SecretKeeping {
  readonly keep: (value: Redacted.Redacted, endsWith?: string) => Effect.Effect<string, { readonly detail: string }>;
  readonly read: (
    id: string,
  ) => Effect.Effect<{ readonly value: Redacted.Redacted } | undefined, { readonly detail: string }>;
  readonly endingsOf: (ids: readonly string[]) => Effect.Effect<ReadonlyMap<string, string>>;
  readonly forget: (id: string) => Effect.Effect<void>;
}

export interface ConnectionServices {
  readonly secrets: SecretKeeping;
  readonly policy: ConnectionPolicy;
  readonly fileEntries: readonly string[];
  readonly modelProviders: readonly string[];
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
  readonly pages: ConnectPages;
  readonly access: RuntimeAccess;
  readonly consent: ConsentClient;
}
