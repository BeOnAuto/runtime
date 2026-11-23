import {
  everyProjectedRow,
  readOnceTogether,
  type ProjectedKeyedRow,
  type ProjectedRowsQuery,
  type ProjectionReader,
} from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import { addedPositionColumn, connectionRowsName, keptInTheRow, type KeptInARow } from './connection-rows.ts';
import { namedNowIn } from './facts-as-named.ts';
import type { KeptConnection, Registry } from './registry.ts';
import { actingAsAddedOf } from './what-connections-act-as.ts';

function readIn(providers: ProviderList, { kept, row }: KeptInARow): KeptConnection {
  const named = namedNowIn(providers, kept.connection);
  const acting = row.credential_as_added ? actingAsAddedOf(named, providers) : undefined;
  if (acting === undefined) {
    return named === kept.connection ? kept : { ...kept, connection: named };
  }
  const { permissions, accountType } = acting;
  return {
    ...kept,
    connection: {
      ...named,
      credential: { ...named.credential, permissions },
      ...(accountType !== undefined && row.account_type_as_added ? { account_type: accountType } : {}),
    },
  };
}

export function registryOfRows(rows: readonly ProjectedKeyedRow[], providers: ProviderList): Registry {
  return new Map(rows.map(({ key, row }) => [key, readIn(providers, keptInTheRow(row))]));
}

export function connectionsKeptIn(
  read: (query: ProjectedRowsQuery) => Effect.Effect<readonly ProjectedKeyedRow[]>,
  providers: ProviderList,
): Effect.Effect<Registry> {
  return Effect.map(everyProjectedRow(read, [addedPositionColumn]), (rows) => registryOfRows(rows, providers));
}

function connectionsOfAnOrgIn(
  reader: Pick<ProjectionReader, 'readProjectedRows'>,
  org: string,
  providers: ProviderList,
): Effect.Effect<Registry> {
  return connectionsKeptIn((query) => reader.readProjectedRows(connectionRowsName, { org }, query), providers);
}

export function connectionsOfAnOrgReadTogetherIn(
  reader: Pick<ProjectionReader, 'readProjectedRows'>,
  providers: ProviderList,
): (org: string) => Effect.Effect<Registry> {
  const keptOnce = readOnceTogether<Registry>();
  return (org) => keptOnce.read(org, connectionsOfAnOrgIn(reader, org, providers));
}
