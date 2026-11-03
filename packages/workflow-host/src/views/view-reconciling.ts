import { Effect, Schema } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { FreshRow, Reconciled, Reconciling, RenamedRow } from '../projector/folder.ts';
import type { KeptFunction } from '../projector/playbook-definitions.ts';
import { viewDetailsOf } from './view-details.ts';
import { viewRowOf, ViewRowSchema, type ViewRow } from './view-rows.ts';
import { playbooksWithViews, viewAdded, viewRenamed, viewRenewed, viewsOfPlaybook } from './view-statements.ts';

const PlaybookRow = Schema.Struct({ playbook_key: Schema.String });

export function playbooksWithViewsIn(database: HostDatabase): Effect.Effect<readonly string[], DatabaseFailed> {
  return Effect.map(rowsOf(PlaybookRow, database.read(playbooksWithViews)), (rows) =>
    rows.map(({ playbook_key: playbookKey }) => playbookKey),
  );
}

export function rowsOfPlaybook(
  database: HostDatabase,
  playbook: string,
): Effect.Effect<readonly ViewRow[], DatabaseFailed> {
  return rowsOf(ViewRowSchema, database.read(viewsOfPlaybook(playbook))).pipe(
    Effect.map((rows) => rows.map((row) => viewRowOf(row))),
  );
}

function freshOf(playbook: string, name: string, kept: KeptFunction, row: ViewRow | undefined): readonly FreshRow[] {
  const details = viewDetailsOf(kept.details);
  if (details === undefined || (row !== undefined && JSON.stringify(row.details) === JSON.stringify(details))) {
    return [];
  }
  const { version, saved } = kept;
  const written = row === undefined ? viewAdded : viewRenewed;
  const view = {
    playbookKey: playbook,
    name,
    version,
    saved,
    details: JSON.stringify(details),
    view: JSON.stringify(details.initial),
  };
  return [{ key: name, saved, added: (phase) => written({ ...view, phase }) }];
}

interface Adoption extends RenamedRow<ViewRow> {
  readonly name: string;
}

function adoptionOf(
  playbook: string,
  [name, kept]: readonly [string, KeptFunction],
  byName: ReadonlyMap<string, ViewRow>,
): readonly Adoption[] {
  const details = viewDetailsOf(kept.details);
  const row = kept.formerly === undefined ? undefined : byName.get(kept.formerly);
  if (details === undefined || row === undefined || row.version !== kept.version || byName.has(name)) {
    return [];
  }
  const renamed = viewRenamed({
    playbookKey: playbook,
    from: row.name,
    name,
    version: kept.version,
    details: JSON.stringify(details),
  });
  return [{ name, row, renamed }];
}

export function plannedViews({ playbook, definitions }: Reconciling, rows: readonly ViewRow[]): Reconciled<ViewRow> {
  const { functions } = definitions;
  const byName = new Map(rows.map((row) => [row.name, row]));
  const adoptions = [...functions].flatMap((entry: readonly [string, KeptFunction]) =>
    adoptionOf(playbook, entry, byName),
  );
  const adopting = new Set(adoptions.map(({ name }) => name));
  const adopted = new Set(adoptions.map(({ row }) => row.name));
  return {
    fresh: [...functions]
      .filter(([name]: readonly [string, KeptFunction]) => !adopting.has(name))
      .flatMap(([name, kept]: readonly [string, KeptFunction]) => freshOf(playbook, name, kept, byName.get(name))),
    dropped: rows.filter(({ name }) => !adopted.has(name) && viewDetailsOf(functions.get(name)?.details) === undefined),
    renamed: adoptions.map(({ row, renamed }) => ({ row, renamed })),
  };
}
