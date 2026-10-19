import type { StreamReader, StreamWriter } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import type { ConnectionUnready } from '@on.auto/tool-servers';
import { DateTime, Effect, Option, type Redacted } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import { byTheRuntime, connectionsStreamOfOrg, registryDecider } from '../registry/registry-decider.ts';
import type { KeptConnection } from '../registry/registry.ts';
import type { GivenValue } from './placed-credentials.ts';
import { servingWords } from './serving-words.ts';

export interface ServingServices {
  readonly registry: StreamReader & StreamWriter;
  readonly secrets: Pick<SecretKeeping, 'read'>;
  readonly policy: ConnectionPolicy;
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

export type Given = Effect.Effect<GivenValue | undefined, ConnectionUnready>;

export function notAllowed(detail: string): ConnectionUnready {
  return { because: 'connection_not_allowed', detail };
}

function broken({ org, kept, services }: Serving, reason: string): Given {
  return Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now);
    const breaking = { type: 'break', connection: kept.connection.id, reason, by: byTheRuntime, at } as const;
    yield* services.registry.execute(connectionsStreamOfOrg(org), registryDecider, breaking).pipe(
      Effect.orDie,
      Effect.catchCause((cause) => Effect.logError(servingWords.unrecorded(kept.connection.name), cause)),
    );
    const unready: ConnectionUnready = { because: 'connection_broken', detail: reason };
    return yield* Effect.fail(unready);
  });
}

function keptSecretOf(serving: Serving): Given {
  const { kept, services } = serving;
  const { name } = kept.connection;
  const secretId = Option.getOrThrow(Option.fromNullishOr(kept.secretId));
  return services.secrets.read(secretId).pipe(
    Effect.matchEffect({
      onFailure: ({ detail }) => broken(serving, servingWords.unreadable(name, detail)),
      onSuccess: (stored) =>
        stored === undefined
          ? broken(serving, servingWords.gone(name))
          : Effect.succeed({ value: stored.value, algorithm: kept.algorithm }),
    }),
  );
}

function referencedOf({ kept, services }: Serving): Given {
  const { credential, name } = kept.connection;
  const variable = Option.getOrThrow(Option.fromNullishOr(credential.variable));
  const value = services.variables.get(variable);
  return value === undefined
    ? Effect.fail(notAllowed(servingWords.unset(name, variable)))
    : Effect.succeed({ value, algorithm: undefined });
}

export function givenOf(serving: Serving): Given {
  const { kind } = serving.kept.connection.credential;
  if (kind === 'none') {
    return Effect.undefined;
  }
  return kind === 'reference' ? referencedOf(serving) : keptSecretOf(serving);
}
