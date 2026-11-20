import type {
  PlaybookAddress,
  ProjectedCondition,
  ProjectedKeyedRow,
  ProjectedRowsQuery,
  ProjectionReader,
} from '@on.auto/operations';
import { connectionNamedBy } from '@on.auto/workflow-engine';
import { Effect, Option, Schema } from 'effect';

import { definitionRows } from '../read-model/definition-rows.ts';
import { TriggerSchema, type EventTrigger, type TriggerFilter } from '../registry/definition-triggers.ts';
import { everyRowOf } from './read-model-rows.ts';

export interface ListenedConnection {
  readonly workflow: string;
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
}

const activeWorkflows: readonly ProjectedCondition[] = [
  { column: 'definition_type', equals: 'workflow' },
  { column: 'status', equals: 'active' },
];

const rowOf = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.String,
    triggers: Schema.NullOr(Schema.fromJsonString(Schema.Array(TriggerSchema))),
  }),
);

function listenedThrough(workflow: string, { type, attributes: { source, subject } }: TriggerFilter) {
  const connection = typeof source === 'string' ? connectionNamedBy(source) : undefined;
  if (connection === undefined) {
    return [];
  }
  const listened: ListenedConnection = { workflow, connection, type };
  return [typeof subject === 'string' ? { ...listened, subject } : listened];
}

function listenedIn({ row }: ProjectedKeyedRow): readonly ListenedConnection[] {
  return Option.match(rowOf(row), {
    onNone: () => [],
    onSome: ({ name, triggers }) =>
      (triggers ?? [])
        .filter((trigger): trigger is EventTrigger => trigger.kind === 'event')
        .flatMap(({ filters }) => filters)
        .flatMap((filter) => listenedThrough(name, filter)),
  });
}

export function listenedConnectionsOf(
  ledger: Pick<ProjectionReader, 'readProjectedRows'>,
  playbook: PlaybookAddress,
): Effect.Effect<readonly ListenedConnection[]> {
  const inThePlaybook = {
    readProjectedRows: (table: string, query: ProjectedRowsQuery) => ledger.readProjectedRows(table, playbook, query),
  };
  return Effect.map(everyRowOf(inThePlaybook, definitionRows.name, activeWorkflows), (rows) =>
    rows.flatMap((row) => listenedIn(row)),
  );
}
