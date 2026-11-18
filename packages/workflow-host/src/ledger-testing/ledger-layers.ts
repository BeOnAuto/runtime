import { definitionTypeOrder, runIds } from '@on.auto/definitions';
import { definitionNamesOf, unbounded } from '@on.auto/definitions/identity';
import type { AppendObserver, LedgerServices } from '@on.auto/ledger';
import type { PostgreSQLPools } from '@on.auto/ledger/postgresql';
import type { ContentHolders } from '@on.auto/operations';
import type { Layer } from 'effect';

interface DatabaseBound {
  readonly mostBoundValues?: number | undefined;
  readonly holders?: ContentHolders | undefined;
}

export type DatabaseSettings = DatabaseBound &
  (
    | { readonly store: 'sqlite'; readonly file: string; readonly observer?: AppendObserver | undefined }
    | { readonly store: 'postgresql'; readonly pools: PostgreSQLPools; readonly observer?: AppendObserver | undefined }
  );

const definitionNames = definitionNamesOf(definitionTypeOrder, unbounded);

export async function ledgerLayerOn(settings: DatabaseSettings): Promise<Layer.Layer<LedgerServices>> {
  if (settings.store === 'sqlite') {
    const { ledgerLayer } = await import('@on.auto/ledger/sqlite');
    return ledgerLayer({
      fileName: settings.file,
      observer: settings.observer,
      holders: settings.holders,
      definitionNames,
      runIds,
    });
  }
  const { postgresqlLedgerLayer } = await import('@on.auto/ledger/postgresql');
  const { holders } = settings;
  return postgresqlLedgerLayer({
    pools: settings.pools,
    observer: settings.observer,
    definitionNames,
    runIds,
    ...(holders === undefined ? {} : { holders }),
  });
}
