import { referencedVariablesOf } from '@on.auto/config';
import { Redacted, Schema } from 'effect';

import type { CredentialWay } from '../entry/credential-ways.ts';
import { setCombinationsOf } from '../entry/placeholders.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';
import { hostTemplateOf } from '../entry/templates.ts';
import type { Provider, ProviderList } from './provider-list.ts';

const asJson = Schema.decodeUnknownSync(Schema.Json);

export function hostAlternativesOf(
  { entry, address }: Provider,
  { issuer }: CredentialWay,
): readonly (readonly string[])[] {
  const addresses = issuer === undefined ? [address] : [address, issuer];
  return setCombinationsOf(entry.placeholders ?? {}).map((placed) =>
    addresses.map((each) => hostTemplateOf(each, (name) => placed.get(name))),
  );
}

export function operatorVariablesOf({ headers = {}, query_params: query = {} }: ProviderEntry): readonly string[] {
  return [...new Set(referencedVariablesOf(asJson({ headers, query })))];
}

export function operatorVariablesIn({ providers }: ProviderList): readonly string[] {
  return [...new Set(providers.flatMap(({ entry }) => operatorVariablesOf(entry)))];
}

export function operatorValuesIn(
  list: ProviderList,
  environment: Readonly<Record<string, string | undefined>>,
): ReadonlyMap<string, Redacted.Redacted> {
  return new Map(
    operatorVariablesIn(list).flatMap((name) => {
      const value = environment[name] ?? '';
      return value === '' ? [] : [[name, Redacted.make(value)] as const];
    }),
  );
}
