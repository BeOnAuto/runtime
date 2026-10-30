import { Effect, Schema } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { FreshRow, Reconciled, Reconciling } from '../projector/folder.ts';
import type { KeptFunction } from '../projector/playbook-definitions.ts';
import { viewDetailsOf } from './view-details.ts';
import { viewRowOf, ViewRowSchema, type ViewRow } from './view-rows.ts';
import { playbooksWithViews, viewAdded, viewRenewed, viewsOfPlaybook } from './view-statements.ts';

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
  if (details === undefined || (row !== undefined && row.version >= kept.version)) {
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

export function plannedViews({ playbook, definitions }: Reconciling, rows: readonly ViewRow[]): Reconciled<ViewRow> {
  const { functions } = definitions;
  const byName = new Map(rows.map((row) => [row.name, row]));
  return {
    fresh: [...functions].flatMap(([name, kept]: readonly [string, KeptFunction]) =>
      freshOf(playbook, name, kept, byName.get(name)),
    ),
    dropped: rows.filter(({ name }) => !functions.has(name)),
  };
}
