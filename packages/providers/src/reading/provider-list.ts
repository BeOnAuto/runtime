import type { Issue } from '@on.auto/operations';
import { Option, Result } from 'effect';

import type { ProviderEntry } from '../entry/provider-entry.ts';
import { isAddress } from '../entry/templates.ts';

export interface Provider {
  readonly entry: ProviderEntry;
  readonly address: string;
}

export interface ProviderList {
  readonly providers: readonly Provider[];
  readonly documents: string;
}

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

export function addressOf(entry: ProviderEntry, documentServer?: string): string {
  if (entry.type === 'mcp') {
    return required(entry.url);
  }
  const document = required(entry.document);
  return entry.base_url ?? (isAddress(document) ? document : required(documentServer));
}

export function documentServerOf({ entry, address }: Provider): string | undefined {
  const { document, base_url: baseUrl } = entry;
  return document === undefined || baseUrl !== undefined || isAddress(document) ? undefined : address;
}

export function providerNamed({ providers }: ProviderList, name: string): Result.Result<Provider, readonly Issue[]> {
  const found = providers.find(({ entry }) => entry.name === name);
  return found === undefined
    ? Result.fail([{ pointer: '/provider', detail: `There is no provider named ${name} here` }])
    : Result.succeed(found);
}
