import {
  Caller,
  defineHttpOperation,
  permissionFor,
  permissionRefusalOf,
  type CallerIdentity,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { addingRefusalOf, adderRefusalOf } from '../policy/policy-rules.ts';
import { ProvidersSchema } from './listed-providers.ts';
import { listedProviders } from './provider-listing.ts';

type Listing = Pick<ConnectionServices, 'providers' | 'providerValues' | 'policy' | 'access'>;

const addingPermissions = [permissionFor('command', 'org')];

function refusalToAdd({ access, policy }: Listing, caller: CallerIdentity): string | null {
  return (
    permissionRefusalOf(addingPermissions, caller) ??
    adderRefusalOf(access, caller)?.detail ??
    addingRefusalOf(policy)?.detail ??
    null
  );
}

export function defineListProviders(listing: Listing) {
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
      return { providers: listedProviders(listing), may_add: refusal === null, refusal };
    }),
  });
}
