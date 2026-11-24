import type { Issue } from '@on.auto/operations';
import type { ClientSource, ShippedDocument } from '@on.auto/tool-servers';
import { Option, Order, Result } from 'effect';

import type { Conversations } from '../entry/conversation-parts.ts';
import { isADocumentBesideTheEntries } from '../entry/entry-values.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';
import { providerNamesOf } from '../entry/provider-names.ts';
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
  const named = new Set(added.flatMap((entry) => providerNamesOf(entry)));
  const ofWhoeverRunsIt = added.map((entry): Provider => ({ entry, address: addressOf(entry) }));
  const shipped = providers.filter(({ entry }) => !providerNamesOf(entry).some((name) => named.has(name)));
  return { providers: [...ofWhoeverRunsIt, ...shipped].toSorted(byName), documents };
}

export function providerFoundBy({ providers }: ProviderList, name: string | null): Provider | undefined {
  return name === null
    ? undefined
    : (providers.find(({ entry }) => entry.name === name) ??
        providers.find(({ entry }) => entry.aliases?.includes(name) === true));
}

export function providerNamed(list: ProviderList, name: string): Result.Result<Provider, readonly Issue[]> {
  const found = providerFoundBy(list, name);
  return found === undefined
    ? Result.fail([{ pointer: '/provider', detail: `There is no provider named ${name} here` }])
    : Result.succeed(found);
}

export interface NamedAs {
  readonly provider: string;
  readonly document: string | undefined;
}

function documentNamedNow(written: string | undefined, now: string | undefined): string | undefined {
  return isADocumentBesideTheEntries(written) && isADocumentBesideTheEntries(now) ? now : written;
}

export function asNamedIn(list: ProviderList, named: NamedAs): NamedAs {
  const found = providerFoundBy(list, named.provider);
  if (found === undefined || found.entry.name === named.provider) {
    return named;
  }
  const { name, document } = found.entry;
  return { provider: name, document: documentNamedNow(named.document, document) };
}

function limitedFor(conversations: Conversations, signedInThrough: ClientSource | undefined): Conversations {
  const { read_limit: limit, ...rest } = conversations;
  const applies =
    limit !== undefined &&
    (limit.clients === undefined || (signedInThrough !== undefined && limit.clients.includes(signedInThrough)));
  return applies ? conversations : rest;
}

export type ConversationsOfAProvider = Conversations & { readonly clicks?: true };

export function conversationsOf(
  list: ProviderList,
  provider: string | null,
  signedInThrough?: ClientSource,
): ConversationsOfAProvider | undefined {
  const entry = providerFoundBy(list, provider)?.entry;
  const conversations = entry?.conversations;
  if (conversations === undefined) {
    return undefined;
  }
  const clicks = entry?.events?.destinations.some(({ filter }) => filter?.click !== undefined) === true;
  return { ...limitedFor(conversations, signedInThrough), ...(clicks ? { clicks: true as const } : {}) };
}

function nameNowIn(list: ProviderList, name: string): string {
  return providerFoundBy(list, name)?.entry.name ?? name;
}

export function replacedNamesOf(
  list: ProviderList,
  { replaces = [] }: Pick<ProviderEntry, 'replaces'>,
): readonly string[] {
  return [...new Set(replaces.map((name) => nameNowIn(list, name)))];
}

export function replacementOf(list: ProviderList, provider: string | null): Provider | undefined {
  if (provider === null) {
    return undefined;
  }
  const replaced = nameNowIn(list, provider);
  return list.providers.find(({ entry }) => replacedNamesOf(list, entry).includes(replaced));
}

export function rendersOf(list: ProviderList, provider: string | null): string | undefined {
  return providerFoundBy(list, provider)?.entry.renders;
}

export function eventDestinationOf(
  list: ProviderList,
  provider: string | null,
  type: EventDestination['type'],
): EventDestination | undefined {
  const events = providerFoundBy(list, provider)?.entry.events;
  return events?.destinations.find((destination) => destination.type === type);
}
