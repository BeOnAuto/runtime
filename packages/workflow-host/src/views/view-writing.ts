import { Effect, Schema } from 'effect';

import { rowsOf, type DatabaseFailed } from '../database/host-database.ts';
import { rowAfter, type ViewChange } from '../pages/view-changes.ts';
import type { Writing } from '../projector/folder.ts';
import type { ViewRow } from './view-rows.ts';
import { foldedWritten } from './view-statements.ts';

const NameRow = Schema.Struct({ name: Schema.String });

function isNewlyStalled({ row, next }: ViewChange): boolean {
  return next.phase === 'stalled' && row.phase !== 'stalled';
}

export function viewWritten(
  { database, playbook, note }: Writing,
  change: ViewChange,
): Effect.Effect<ViewRow | undefined, DatabaseFailed> {
  const { row } = change;
  return rowsOf(NameRow, database.write(foldedWritten(row, change.next))).pipe(
    Effect.map((rows) => rows.length > 0),
    Effect.tap((took) =>
      took && isNewlyStalled(change)
        ? note({ kind: 'view_stalled', playbook, name: row.name, version: row.version })
        : Effect.void,
    ),
    Effect.map((took) => (took ? rowAfter(change) : undefined)),
  );
}
