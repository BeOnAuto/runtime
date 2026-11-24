import { Struct } from 'effect';

import { added, type Added } from './additions.ts';
import {
  exchangeFetch,
  exchangeProviders,
  fakeServiceAccounts,
  fakeSubjectTokens,
  listingOf,
  listingReads,
  type ExchangeFetch,
  type FakeServiceAccounts,
  type FakeSubjectTokens,
  type ListingReads,
} from './exchanges.ts';
import { ada, harness, operationNamed, type Harness, type HarnessOptions } from './harness.ts';

export interface Exchanging {
  readonly h: Harness;
  readonly accounts: FakeServiceAccounts;
  readonly exchange: ExchangeFetch;
  readonly reads: ListingReads;
  readonly tokens: FakeSubjectTokens;
  readonly options: HarnessOptions;
}

export type Port = 'subjectTokens' | 'managedServiceAccounts';

export const reachedAtFirst = ['sales@acme.example.com', 'support@acme.example.com'];

export function exchanging(changes: HarnessOptions = {}, without: readonly Port[] = []): Exchanging {
  const accounts = fakeServiceAccounts();
  const exchange = exchangeFetch();
  const reads = listingReads(listingOf(...reachedAtFirst));
  const tokens = fakeSubjectTokens();
  const ports = { subjectTokens: tokens, managedServiceAccounts: accounts };
  const options: HarnessOptions = {
    providers: exchangeProviders,
    ...Struct.omit(ports, without),
    fetch: exchange.fetch,
    readOnceThrough: reads.readOnceThrough,
    ...changes,
  };
  return { h: harness(options), accounts, exchange, reads, tokens, options };
}

export function sameLedgerWith({ h, options }: Exchanging, changes: HarnessOptions, without: readonly Port[] = []) {
  return harness({ ...Struct.omit(options, without), ...changes, ledger: h.ledger });
}

interface Adding {
  readonly placeholders?: Readonly<Record<string, string>>;
  readonly name?: string;
}

export function addedThe(h: Harness, credential: unknown, adding: Adding = {}): Promise<Added> {
  return added(h, { provider: 'mail', credential, ...adding });
}

export function onTheLink(
  h: Harness,
  name: string,
  { id, token }: Added,
  more: Readonly<Record<string, unknown>> = {},
) {
  return h.call(operationNamed(h.operations, name), ada, { id, token, ...more });
}

export function byItsId(h: Harness, name: string, { id }: Added) {
  return h.call(operationNamed(h.operations, name), ada, { id });
}
