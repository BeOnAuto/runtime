import { Caller, defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ProvidersSchema } from './listed-providers.ts';
import { listedProviders } from './provider-listing.ts';
import { refusalToAdd, type OfferingServices } from './provider-offering.ts';

export function defineListProviders(listing: OfferingServices) {
  return defineHttpOperation('org', 'query', {
    name: 'list_providers',
    title: 'List providers',
    description: [
      'Lists the providers a person may connect here, by name, each with the ways a credential reaches its server and the values a connection to it takes.',
      'Use it to show a person what they can connect; add_connection connects one by its name.',
      '`may_add` says whether this caller may add a connection, and `refusal` why not.',
    ].join(' '),
    route: { method: 'GET', path: '/providers' },
    body: { kind: 'none' },
    inputSchema: Schema.Record(Schema.String, Schema.Never),
    answer: { kind: 'json', outputSchema: ProvidersSchema },
    reasons: [],
    handle: Effect.fnUntraced(function* () {
      const refusal = refusalToAdd(listing, yield* Caller);
      const consent = yield* listing.consent.hadSources;
      return { providers: listedProviders({ ...listing, consent }), may_add: refusal === null, refusal };
    }),
  });
}
