import type { Provider } from '@on.auto/providers';
import { Option } from 'effect';

import type { AdditionGiven } from '../operations/connection-fields.ts';
import type { ConnectionEntry } from '../registry/connection-entry.ts';
import type { KeptConnection } from '../registry/registry.ts';

type CarriedEntry = Pick<ConnectionEntry, 'playbooks' | 'allowed' | 'record_content'>;

function carriedEntryOf({ playbooks, allowed, record_content: recordContent }: ConnectionEntry): CarriedEntry {
  return {
    ...(playbooks === undefined ? {} : { playbooks }),
    ...(allowed === undefined ? {} : { allowed }),
    ...(recordContent === undefined ? {} : { record_content: recordContent }),
  };
}

function carriedPlaceholdersOf(
  placeholders: Readonly<Record<string, string>> | null,
  { entry }: Provider,
): Pick<AdditionGiven, 'placeholders'> {
  const declared = entry.placeholders ?? {};
  const given = Option.getOrThrow(Option.fromNullishOr(placeholders));
  const carried = Object.entries(given).filter(([name]: readonly [string, string]) => Object.hasOwn(declared, name));
  return carried.length === 0 ? {} : { placeholders: Object.fromEntries(carried) };
}

export function givenAgainFrom(from: Provider, { connection }: KeptConnection): AdditionGiven {
  return {
    name: connection.name,
    provider: from.entry.name,
    ...carriedPlaceholdersOf(connection.placeholders, from),
    entry: carriedEntryOf(connection.entry),
  };
}
