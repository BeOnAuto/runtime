import { DirectoryListing, Unavailable } from '@on.auto/operations';
import type { Provider, ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import type { AdditionInput } from '../entries/entry-checks.ts';

function isNamedIn(
  { provider, entry }: Pick<AdditionInput, 'provider' | 'entry'>,
  { entry: named, address }: Provider,
) {
  return named.name === provider || address === entry.url || address === entry.document;
}

function moneyProviderOf(providers: ProviderList, given: Pick<AdditionInput, 'provider' | 'entry'>) {
  return providers.providers.find((provider) => provider.entry.handles_money === true && isNamedIn(given, provider));
}

export const refusedInTheDirectoryListing = Effect.fnUntraced(function* (
  providers: ProviderList,
  given: Pick<AdditionInput, 'provider' | 'entry'>,
) {
  const money = (yield* DirectoryListing) ? moneyProviderOf(providers, given) : undefined;
  return yield* money === undefined
    ? Effect.void
    : Effect.fail(
        new Unavailable({
          detail: `The directory listing does not offer ${money.entry.title}, whose tools pay, refund, transfer or pay out money`,
        }),
      );
});
