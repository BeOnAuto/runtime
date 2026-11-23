import {
  Conflict,
  type PlaybookAddress,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedRowsQuery,
  type ProjectionReader,
} from '@on.auto/operations';
import { connectionNamedBy } from '@on.auto/workflow-engine';
import { Effect, Option, Schema } from 'effect';

import { definitionRows } from '../read-model/definition-rows.ts';
import { TriggerSchema, type EventTrigger, type Trigger, type TriggerFilter } from '../registry/definition-triggers.ts';
import { anotherReadWords, readingAnotherUnderTheirType, type TriggerRead } from '../registry/trigger-reads.ts';
import { everyRowOf, type ReadModelReader } from './read-model-rows.ts';

export interface ListenedConnection {
  readonly workflow: string;
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
  readonly read?: TriggerRead;
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

function listenedThrough(workflow: string, { type, attributes: { source, subject }, read }: TriggerFilter) {
  const connection = typeof source === 'string' ? connectionNamedBy(source) : undefined;
  if (connection === undefined) {
    return [];
  }
  const listened: ListenedConnection = {
    workflow,
    connection,
    type,
    ...(typeof subject === 'string' ? { subject } : {}),
    ...(read === undefined ? {} : { read }),
  };
  return [listened];
}

function listenedByTheTriggers(workflow: string, triggers: readonly Trigger[]): readonly ListenedConnection[] {
  return triggers
    .filter((trigger): trigger is EventTrigger => trigger.kind === 'event')
    .flatMap(({ filters }) => filters)
    .flatMap((filter) => listenedThrough(workflow, filter));
}

function listenedIn({ row }: ProjectedKeyedRow): readonly ListenedConnection[] {
  return Option.match(rowOf(row), {
    onNone: () => [],
    onSome: ({ name, triggers }) => listenedByTheTriggers(name, triggers ?? []),
  });
}

type RowsOfThePlaybook = Pick<ReadModelReader, 'readProjectedRows'>;

function listenedConnectionsIn(rows: RowsOfThePlaybook): Effect.Effect<readonly ListenedConnection[]> {
  return Effect.map(everyRowOf(rows, definitionRows.name, activeWorkflows), (listed) =>
    listed.flatMap((row) => listenedIn(row)),
  );
}

export function listenedConnectionsOf(
  ledger: Pick<ProjectionReader, 'readProjectedRows'>,
  playbook: PlaybookAddress,
): Effect.Effect<readonly ListenedConnection[]> {
  return listenedConnectionsIn({
    readProjectedRows: (table: string, query: ProjectedRowsQuery) => ledger.readProjectedRows(table, playbook, query),
  });
}

interface MadeActive {
  readonly name: string;
  readonly triggers?: readonly Trigger[];
}

export function anotherReadRefused(
  rows: RowsOfThePlaybook,
  made: readonly MadeActive[],
  playbook?: string,
): Effect.Effect<void, Conflict> {
  const asked = made.flatMap(({ name, triggers = [] }) => listenedByTheTriggers(name, triggers));
  if (asked.length === 0) {
    return Effect.void;
  }
  const names = new Set(made.map(({ name }) => name));
  return Effect.flatMap(listenedConnectionsIn(rows), (listened) => {
    const held = listened.filter(({ workflow }) => !names.has(workflow));
    const [first] = readingAnotherUnderTheirType(asked, held);
    return first === undefined ? Effect.void : Effect.fail(new Conflict({ detail: anotherReadWords(first, playbook) }));
  });
}
