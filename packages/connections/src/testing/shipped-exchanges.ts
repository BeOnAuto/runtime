import {
  isAManagedServiceAccount,
  type Placeholder,
  type ProviderAddition,
  type ProviderList,
} from '@on.auto/providers';
import type { ExchangeAuth } from '@on.auto/tool-servers';
import { Option, Result } from 'effect';

import type { RecordedConnectionEvent } from '../registry/connection-events.ts';
import { evolveRegistry, initialRegistry, type KeptConnection, type Registry } from '../registry/registry.ts';
import { wayOfTheConnection } from '../registry/what-connections-act-as.ts';
import { exchangeAuthOf } from '../serving/exchanged-credentials.ts';

type Given = Readonly<Record<string, string>>;

export type Placeholders = Readonly<Record<string, Placeholder>>;

function valuesOf({ example = '', choices }: Placeholder): readonly string[] {
  return choices === undefined ? [example] : choices.map(({ value }) => value);
}

function givenOf(given: readonly Given[], [name, placeholder]: readonly [string, Placeholder]): readonly Given[] {
  return given.flatMap((each) =>
    valuesOf(placeholder).map((value) => Object.fromEntries([...Object.entries(each), [name, value]])),
  );
}

export function examplesOf(placeholders: Placeholders): readonly Given[] {
  return Object.entries(placeholders).reduce<readonly Given[]>(
    (given, placeholder: readonly [string, Placeholder]) => givenOf(given, placeholder),
    [{}],
  );
}

const recorded = { at: '2026-11-24T10:00:00.000Z', by: 'person:ada' };

const createdServiceAccount = { id: 'service-account-1', email: 'auto@service-account.example.com' };

function addedOf({ name, type, provider, placeholders, entry, credential }: ProviderAddition): RecordedConnectionEvent {
  const addedBy = { id: recorded.by, name: 'Ada' };
  const data = { connection: name, name, server_type: type, provider, placeholders, entry, credential, says: {} };
  return { type: 'connection_added', data: { ...data, added_by: addedBy }, context: recorded };
}

function serviceAccountOf(addition: ProviderAddition, providers: ProviderList): readonly RecordedConnectionEvent[] {
  if (!isAManagedServiceAccount(addition.credential)) {
    return [];
  }
  const way = Option.getOrThrow(Option.fromNullishOr(wayOfTheConnection(addition, providers)));
  return examplesOf({ ...way.placeholders })
    .slice(0, 1)
    .map((placeholders): RecordedConnectionEvent => ({
      type: 'connection_service_account_created',
      data: { connection: addition.name, ...createdServiceAccount, placeholders },
      context: recorded,
    }));
}

function keptOf(addition: ProviderAddition, providers: ProviderList): KeptConnection {
  const registry = [addedOf(addition), ...serviceAccountOf(addition, providers)].reduce(
    (folded: Registry, event: RecordedConnectionEvent) => evolveRegistry(folded, event),
    initialRegistry,
  );
  return Option.getOrThrow(Option.fromNullishOr(registry.get(addition.name)));
}

export function exchangeAuthOfTheAddition(addition: ProviderAddition, providers: ProviderList): ExchangeAuth {
  return Result.getOrThrow(exchangeAuthOf(keptOf(addition, providers), providers));
}
