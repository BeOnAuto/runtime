import { recordedDecoder, type KeyedProjection, type ProjectedKeyedRow, type ProjectedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { PlaybookEventSchema, type RecordedPlaybookEvent } from './playbook-events.ts';
import { PlaybookSchema, type Playbook } from './playbook.ts';
import { playbooksStream } from './playbooks-stream.ts';
import { evolveRegistry, type Registry } from './registry.ts';

export const playbookRowsName = 'playbooks';

export const createdPositionColumn = 'created_position';

const playbookFactOf = recordedDecoder(PlaybookEventSchema);

const PlaybookRowSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  status: PlaybookSchema.fields.status,
  created_at: Schema.String,
  created_by_id: Schema.String,
  created_by_name: Schema.String,
  updated_at: Schema.String,
  retired_at: Schema.NullOr(Schema.String),
  created_position: Schema.Int,
});

const playbookRowOf = Schema.decodeUnknownSync(PlaybookRowSchema);

export function playbookOfRow(id: string, row: ProjectedRow): Playbook {
  const kept = playbookRowOf(row);
  return {
    id,
    name: kept.name,
    description: kept.description,
    status: kept.status,
    created_at: kept.created_at,
    created_by: { id: kept.created_by_id, name: kept.created_by_name },
    updated_at: kept.updated_at,
    ...(kept.retired_at === null ? {} : { retired_at: kept.retired_at }),
  };
}

function rowOf(playbook: Playbook, createdPosition: number): ProjectedRow {
  return {
    name: playbook.name,
    description: playbook.description,
    status: playbook.status,
    created_at: playbook.created_at,
    created_by_id: playbook.created_by.id,
    created_by_name: playbook.created_by.name,
    updated_at: playbook.updated_at,
    retired_at: playbook.retired_at ?? null,
    created_position: createdPosition,
  };
}

function rowAfterFact(
  row: ProjectedRow | undefined,
  fact: RecordedPlaybookEvent,
  position: number,
): ProjectedRow | undefined {
  const id = fact.data.playbook;
  const before: Registry = row === undefined ? new Map() : new Map([[id, playbookOfRow(id, row)]]);
  const after = evolveRegistry(before, fact).get(id);
  return after === undefined || after === before.get(id)
    ? undefined
    : rowOf(after, row === undefined ? position : playbookRowOf(row).created_position);
}

const playbookRowsLayout = 31;

export const playbookRowsLayoutSteps = [{ layout: playbookRowsLayout, statements: [] }] as const;

export const playbookRows: KeyedProjection = {
  name: playbookRowsName,
  version: 1,
  scopes: ['org'],
  kinds: [playbooksStream],
  types: ['playbook_created', 'playbook_updated', 'playbook_retired', 'playbook_restored'],
  columns: [
    { name: 'name', kind: 'text' },
    { name: 'description', kind: 'text' },
    { name: 'status', kind: 'text' },
    { name: 'created_at', kind: 'text' },
    { name: 'created_by_id', kind: 'text' },
    { name: 'created_by_name', kind: 'text' },
    { name: 'updated_at', kind: 'text' },
    { name: 'retired_at', kind: 'text' },
    { name: createdPositionColumn, kind: 'integer' },
  ],
  indexes: [],
  keyOf: (message) => Option.getOrUndefined(Option.map(playbookFactOf(message), ({ data }) => data.playbook)),
  rowAfter: (row, message) =>
    Option.getOrUndefined(
      Option.flatMapNullishOr(playbookFactOf(message), (fact) => rowAfterFact(row, fact, message.position)),
    ),
};

export function registryOfRows(rows: readonly ProjectedKeyedRow[]): Registry {
  return new Map(rows.map(({ key, row }) => [key, playbookOfRow(key, row)]));
}
