import type { StreamReader } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import { connectionsFoldOf, connectionsStreamOfOrg } from './registry-decider.ts';
import type { KeptConnection } from './registry.ts';

export interface ModelChosen {
  readonly provider: string;
  readonly account: string;
  readonly model: string;
}

interface ChosenModelsReading {
  readonly registry: Pick<StreamReader, 'load'>;
  readonly providers: ProviderList;
}

function chosenOf({ connection, model }: KeptConnection): readonly (ModelChosen & { readonly at: string })[] {
  const { status, provider, account, connected_at: at } = connection;
  return status !== 'connected' || provider === null || account === null || model === null || at === null
    ? []
    : [{ provider, account: account.id, model, at }];
}

export function modelsChosenIn(
  { registry, providers }: ChosenModelsReading,
  org: string,
): Effect.Effect<readonly ModelChosen[]> {
  return Effect.map(registry.load(connectionsStreamOfOrg(org), connectionsFoldOf(providers)), ({ state }) =>
    [...state.values()]
      .flatMap((kept) => chosenOf(kept))
      .toSorted((one, other) => one.at.localeCompare(other.at))
      .map(({ provider, account, model }) => ({ provider, account, model })),
  );
}
