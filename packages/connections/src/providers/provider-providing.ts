import { documentServerOf, providerNamed, type Provider, type ProviderList } from '@on.auto/providers';
import { failureCodesOf } from '@on.auto/tool-servers';
import { Result, type Redacted } from 'effect';

import type { AdditionInput } from '../entries/entry-checks.ts';
import type { Providing } from '../serving/placed-credentials.ts';
import { declaredGatewayOf } from './provider-listing.ts';

export interface ProviderServices {
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
}

const handlingMoney: Pick<Providing, 'handles_money'> = { handles_money: true };

function gatewayProvidedBy(provider: Provider): Pick<Providing, 'gateway'> {
  const gateway = declaredGatewayOf(provider);
  return gateway === undefined ? {} : { gateway };
}

function providedBy(provider: Provider): Omit<Providing, 'documents' | 'values'> {
  const { entry } = provider;
  const consenting = entry.credentials.find(({ kind }) => kind === 'authorization');
  return {
    ...gatewayProvidedBy(provider),
    documentServer: documentServerOf(provider),
    type: entry.type,
    marks: entry.marks,
    ...failureCodesOf(entry.failure_codes),
    ...(consenting?.ending_codes === undefined ? {} : { ending_codes: consenting.ending_codes }),
    ...(entry.handles_money === true ? handlingMoney : {}),
    ...(entry.renders === undefined ? {} : { renders: entry.renders }),
  };
}

export function providingOf(
  { provider }: Pick<AdditionInput, 'provider'>,
  { providers, providerValues }: ProviderServices,
): Providing | undefined {
  if (provider === null) {
    return undefined;
  }
  const named = Result.getOrUndefined(providerNamed(providers, provider));
  const given = { documents: providers.documents, values: providerValues };
  return named === undefined ? { ...given, documentServer: undefined } : { ...given, ...providedBy(named) };
}
