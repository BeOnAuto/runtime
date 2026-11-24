import type { Issue } from '@on.auto/operations';
import { exchangeOfProvider, providerFoundBy, type ProviderList } from '@on.auto/providers';
import type { ConnectionUnready, ExchangeAuth } from '@on.auto/tool-servers';
import { Effect, Result } from 'effect';

import type { KeptConnection } from '../registry/registry.ts';
import { wayOfTheConnection } from '../registry/what-connections-act-as.ts';
import { notAllowed } from './given-credentials.ts';
import type { Serving } from './serving-services.ts';
import { servingWords } from './serving-words.ts';

type Exchanged = Pick<KeptConnection, 'connection' | 'serviceAccount'>;

function wayNoLongerOffered({ name, provider }: Exchanged['connection']): readonly Issue[] {
  return [
    {
      pointer: '/credential',
      detail: `The provider ${String(provider)} no longer offers the way the connection ${name} connects by`,
    },
  ];
}

export function exchangesItsToken({ connection }: Pick<KeptConnection, 'connection'>): boolean {
  return connection.credential.kind === 'token_exchange';
}

export function exchangeAuthOf(
  { connection, serviceAccount }: Exchanged,
  providers: ProviderList,
): Result.Result<ExchangeAuth, readonly Issue[]> {
  const named = providerFoundBy(providers, connection.provider);
  const way = wayOfTheConnection(connection, providers);
  if (named === undefined || way?.kind !== 'token_exchange') {
    return Result.fail(wayNoLongerOffered(connection));
  }
  const given = { ...connection.placeholders, ...serviceAccount?.placeholders };
  return Result.map(exchangeOfProvider(named.entry, way, given), ({ scope, ...exchange }) => ({
    ...exchange,
    grant: 'token_exchange',
    scope: scope ?? null,
    credential: { kind: 'subject_token' },
  }));
}

export function unchecked(name: string, issues: readonly Issue[]): ConnectionUnready {
  return notAllowed(
    servingWords.unchecked(
      name,
      issues.map(({ detail }) => detail),
    ),
  );
}

export function exchangeAuthServed({
  kept,
  services,
}: Serving): Effect.Effect<ExchangeAuth | undefined, ConnectionUnready> {
  if (!exchangesItsToken(kept)) {
    return Effect.undefined;
  }
  return Effect.mapError(Effect.fromResult(exchangeAuthOf(kept, services.providers)), (issues) =>
    unchecked(kept.connection.name, issues),
  );
}
