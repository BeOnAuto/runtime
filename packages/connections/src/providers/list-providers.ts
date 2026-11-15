import { Caller, defineHttpOperation, type Runnable } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { returnAddressOf, studioBaseFor } from '../links/connect-page.ts';
import { startOf, type ConnectionStart, type StartsOfConnections } from '../policy/connection-starts.ts';
import { ProvidersSchema, type ListedProvider } from './listed-providers.ts';
import { listedProviders } from './provider-listing.ts';
import { addingRefusedTo, type OfferingServices } from './provider-offering.ts';

type Reconnecting = Pick<ListedProvider, 'may_reconnect' | 'reconnect_refusal'>;

function reconnectingOf(start: ConnectionStart): Reconnecting {
  if (start === 'anyone') {
    return {};
  }
  return start === 'an admin' ? { may_reconnect: true } : { may_reconnect: false, reconnect_refusal: start.refused };
}

function withWhoReconnects(services: StartsOfConnections) {
  return (provider: ListedProvider): Effect.Effect<ListedProvider> =>
    provider.replaces === undefined
      ? Effect.succeed(provider)
      : startOf(services, provider.name).pipe(
          Effect.map((start) => ({ ...provider, ...reconnectingOf(start) })),
          Effect.orElseSucceed(() => provider),
        );
}

export function defineListProviders(listing: OfferingServices & StartsOfConnections, adding: Runnable<'org'>) {
  return defineHttpOperation('org', 'query', {
    name: 'list_providers',
    title: 'List providers',
    description: [
      'Lists the providers a person may connect here, by name, each with the ways a credential reaches its server and the values a connection to it takes.',
      'Use it to show a person what they can connect; add_connection connects one by its name.',
      '`may_add` says whether this caller may add a connection, and `refusal` why not.',
      "`return_address` is the redirect URI the organization's own OAuth client registers at a provider before a person connects under it.",
    ].join(' '),
    route: { method: 'GET', path: '/providers' },
    body: { kind: 'none' },
    inputSchema: Schema.Record(Schema.String, Schema.Never),
    outputSchema: ProvidersSchema,
    reasons: [],
    handle: Effect.fnUntraced(function* () {
      const refusal = yield* addingRefusedTo(listing, adding, yield* Caller);
      const consent = yield* listing.consent.hadSources(studioBaseFor(listing.pages));
      return {
        providers: yield* Effect.forEach(listedProviders({ ...listing, consent }), withWhoReconnects(listing)),
        may_add: refusal === null,
        refusal,
        return_address: returnAddressOf(listing.pages),
      };
    }),
  });
}
