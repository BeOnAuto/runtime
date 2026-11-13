import type { Issue } from '@on.auto/operations';
import type { ClientSource, ShippedDocument } from '@on.auto/tool-servers';
import { Option, Order, Result } from 'effect';

import type { Conversations } from '../entry/conversation-parts.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';
import { isAddress } from '../entry/templates.ts';
import type { Destination as EventDestination } from '../events/destination-fields.ts';

export interface Provider {
  readonly entry: ProviderEntry;
  readonly address: string;
}

export interface ProviderList {
  readonly providers: readonly Provider[];
  readonly documents: ReadonlyMap<string, ShippedDocument>;
}

export function addressOf(entry: ProviderEntry, documentServer?: string): string {
  if (entry.type === 'mcp') {
    return Option.getOrThrow(Option.fromNullishOr(entry.url));
  }
  const document = Option.getOrThrow(Option.fromNullishOr(entry.document));
  return entry.base_url ?? (isAddress(document) ? document : Option.getOrThrow(Option.fromNullishOr(documentServer)));
}

export function documentServerOf({ entry, address }: Provider): string | undefined {
  const { document, base_url: baseUrl } = entry;
  return document === undefined || baseUrl !== undefined || isAddress(document) ? undefined : address;
}

export const byName: Order.Order<Provider> = Order.mapInput(Order.String, ({ entry }: Provider) => entry.name);

export function joinedProviders({ providers, documents }: ProviderList, added: readonly ProviderEntry[]): ProviderList {
  const named = new Set(added.map(({ name }) => name));
  const ofWhoeverRunsIt = added.map((entry): Provider => ({ entry, address: addressOf(entry) }));
  const shipped = providers.filter(({ entry }) => !named.has(entry.name));
  return { providers: [...ofWhoeverRunsIt, ...shipped].toSorted(byName), documents };
}

export function providerNamed({ providers }: ProviderList, name: string): Result.Result<Provider, readonly Issue[]> {
  const found = providers.find(({ entry }) => entry.name === name);
  return found === undefined
    ? Result.fail([{ pointer: '/provider', detail: `There is no provider named ${name} here` }])
    : Result.succeed(found);
}

function limitedFor(conversations: Conversations, signedInThrough: ClientSource | undefined): Conversations {
  const { read_limit: limit, ...rest } = conversations;
  const applies =
    limit !== undefined &&
    (limit.clients === undefined || (signedInThrough !== undefined && limit.clients.includes(signedInThrough)));
  return applies ? conversations : rest;
}

export function conversationsOf(
  { providers }: ProviderList,
  provider: string | null,
  signedInThrough?: ClientSource,
): Conversations | undefined {
  const conversations = providers.find(({ entry }) => entry.name === provider)?.entry.conversations;
  return conversations === undefined ? undefined : limitedFor(conversations, signedInThrough);
}

export function rendersOf({ providers }: ProviderList, provider: string | null): string | undefined {
  return providers.find(({ entry }) => entry.name === provider)?.entry.renders;
}

export function eventDestinationOf(
  { providers }: ProviderList,
  provider: string | null,
  type: EventDestination['type'],
): EventDestination | undefined {
  const events = providers.find(({ entry }) => entry.name === provider)?.entry.events;
  return events?.destinations.find((destination) => destination.type === type);
}
