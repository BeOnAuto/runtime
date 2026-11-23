import {
  documentServerOf,
  isTheWayAsked,
  providerNamed,
  requestOriginsOf,
  type Provider,
  type ProviderList,
} from '@on.auto/providers';
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

type OfAWay = Pick<AdditionInput, 'provider' | 'credential'>;

function providedBy(provider: Provider, { credential }: OfAWay): Omit<Providing, 'documents' | 'values'> {
  const { entry } = provider;
  const way = entry.credentials.find((offered) => isTheWayAsked(offered, credential));
  return {
    ...gatewayProvidedBy(provider),
    documentServer: documentServerOf(provider),
    type: entry.type,
    marks: entry.marks,
    ...failureCodesOf(entry.failure_codes),
    ...(way?.ending_codes === undefined ? {} : { ending_codes: way.ending_codes }),
    ...(way?.path_values === undefined ? {} : { path_values: way.path_values }),
    ...(entry.handles_money === true ? handlingMoney : {}),
    ...(entry.renders === undefined ? {} : { renders: entry.renders }),
    requestOrigins: requestOriginsOf(entry),
  };
}

export function providingOf(
  connection: OfAWay,
  { providers, providerValues }: ProviderServices,
): Providing | undefined {
  const { provider } = connection;
  if (provider === null) {
    return undefined;
  }
  const named = Result.getOrUndefined(providerNamed(providers, provider));
  const given = { documents: providers.documents, values: providerValues };
  return named === undefined ? { ...given, documentServer: undefined } : { ...given, ...providedBy(named, connection) };
}
