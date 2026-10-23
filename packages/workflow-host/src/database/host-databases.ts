import type { AppendObserver } from '@on.auto/ledger';
import type { PostgreSQLPools } from '@on.auto/ledger/postgresql';

import type { HostDatabase } from './host-database.ts';
import type { Statement } from './statement.ts';

export type DatabaseSettings =
  | { readonly store: 'sqlite'; readonly file: string; readonly observer?: AppendObserver | undefined }
  | { readonly store: 'postgresql'; readonly pools: PostgreSQLPools; readonly observer?: AppendObserver | undefined };

export async function openHostDatabase(
  settings: DatabaseSettings,
  reportLostConnection: (error: Readonly<Error>) => void,
  tables: readonly Statement[] = [],
): Promise<HostDatabase> {
  if (settings.store === 'sqlite') {
    const { openSQLiteDatabase } = await import('./sqlite-database.ts');
    return openSQLiteDatabase(settings.file, tables, settings.observer);
  }
  const { openPostgreSQLDatabase } = await import('./postgresql-database.ts');
  return openPostgreSQLDatabase({ pools: settings.pools, reportLostConnection, tables, observer: settings.observer });
}
