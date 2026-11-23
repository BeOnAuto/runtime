import { everyProjectedRow, OrgReader, type Caller, type NotFound } from '@on.auto/operations';
import { readablePlaybooks } from '@on.auto/operations/entities';
import { Effect } from 'effect';

import { createdPositionColumn, playbookOfRow, playbookRowsName, registryOfRows } from '../registry/playbook-rows.ts';
import type { Playbook } from '../registry/playbook.ts';
import { playbookNotFound } from '../registry/registry-lookup.ts';
import type { Registry } from '../registry/registry.ts';

function playbooksOfKeys(ids: readonly string[]): Effect.Effect<readonly (Playbook | undefined)[], never, OrgReader> {
  return Effect.map(
    OrgReader.use((reader) => reader.readProjectedRowsOfKeys(playbookRowsName, ids)),
    (rows) => rows.map((kept) => (kept === undefined ? undefined : playbookOfRow(kept.key, kept.row))),
  );
}

export function playbookOfKey(id: string): Effect.Effect<Playbook, NotFound, OrgReader> {
  return Effect.flatMap(playbooksOfKeys([id]), ([playbook]) =>
    playbook === undefined ? Effect.fail(playbookNotFound(id)) : Effect.succeed(playbook),
  );
}

export const everyPlaybook: Effect.Effect<Registry, never, OrgReader> = Effect.map(
  OrgReader.use((reader) =>
    reader.readTogether(
      everyProjectedRow((query) => reader.readProjectedRows(playbookRowsName, query), [createdPositionColumn]),
    ),
  ),
  registryOfRows,
);

export function playbooksReadableIn(registry: Registry): Effect.Effect<readonly Playbook[], never, Caller> {
  return Effect.map(readablePlaybooks(registry.keys()), (readable) => {
    const may = new Set(readable);
    return [...registry.values()].filter(({ id }) => may.has(id));
  });
}
