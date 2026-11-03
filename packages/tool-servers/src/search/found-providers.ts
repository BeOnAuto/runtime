import type { CallerIdentity } from '@on.auto/operations';
import { Effect, Order } from 'effect';

import { offeredInTheListing } from '../access/directory-listing.ts';
import type { OrgListing } from '../listing/listing-ways.ts';
import type { ServerFields } from '../listing/tool-server.ts';
import type { OrgFound, OrgSearchAsked } from './search-schemas.ts';
import { bestOf, wholeWithinTheBound, type Searchable } from './search-scoring.ts';

export interface OfferedProvider {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly handles_money?: true;
}

export type ProviderOffering = (caller: CallerIdentity) => Effect.Effect<readonly OfferedProvider[] | undefined>;

export const offersNoProvider: ProviderOffering = () => Effect.undefined;

const byName: Order.Order<OfferedProvider> = Order.mapInput(Order.String, ({ name }: OfferedProvider) => name);

function searchableOf({ name, title, description }: OfferedProvider): Searchable {
  return { names: [name, title], argumentNames: [], description };
}

function servedAmong(settings: readonly ServerFields[]): ReadonlySet<string> {
  return new Set(settings.flatMap(({ provider }) => (provider === null ? [] : [provider])));
}

function providersFoundIn(
  offered: readonly OfferedProvider[],
  settings: readonly ServerFields[],
  terms: string | undefined,
): readonly OfferedProvider[] {
  const served = servedAmong(settings);
  const unserved = offered.filter(({ name }) => !served.has(name));
  return terms === undefined
    ? wholeWithinTheBound(unserved.toSorted(byName))
    : bestOf(unserved, terms, searchableOf, byName);
}

export function providersOf(
  offered: readonly OfferedProvider[] | undefined,
  { settings }: OrgListing,
  { server, terms }: OrgSearchAsked,
): Pick<OrgFound, 'providers'> {
  return offered === undefined || server !== undefined ? {} : { providers: providersFoundIn(offered, settings, terms) };
}

export const serversInTheListing = offeredInTheListing;

function shownOf({ name, title, description: said }: OfferedProvider): OfferedProvider {
  return { name, title, description: said };
}

export function providersInTheListing(
  offered: readonly OfferedProvider[] | undefined,
): Effect.Effect<readonly OfferedProvider[] | undefined> {
  return offered === undefined
    ? Effect.undefined
    : Effect.map(offeredInTheListing(offered), (listed) => listed.map((provider) => shownOf(provider)));
}
