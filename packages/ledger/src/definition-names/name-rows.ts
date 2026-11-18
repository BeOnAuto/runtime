import { SQL } from '@event-driven-io/dumbo';
import type {
  DefinitionName,
  HeldName,
  NameInAPlaybook,
  StreamInAPlaybook,
} from '@on.auto/operations/definition-names';
import { Schema } from 'effect';

import type { DefinitionNamesStore, StatementExecutor } from '../event-store.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import type { ReadQuery } from '../scrub/scrubbed-facts.ts';
import { definitionNames } from './definition-names-table.ts';

const NameRows = Schema.Array(
  Schema.Struct({
    playbook_key: Schema.String,
    definition_type: Schema.String,
    name: Schema.String,
    definition_key: Schema.String,
    status: Schema.String,
    has_triggers: Schema.Union([Schema.Boolean, Schema.Literals([0, 1])]),
  }),
);

const decodeNameRows = Schema.decodeUnknownSync(NameRows);

const decodeHolderRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ definition_key: Schema.String })));

const defaultPartition = 'emt:default';

export function readOn(execute: StatementExecutor): ReadQuery {
  return async (sql) => (await execute.query(sql)).rows;
}

async function heldWhere(read: ReadQuery, where: SQL): Promise<readonly HeldName[]> {
  const rows = await read(
    SQL`SELECT playbook_key, definition_type, name, definition_key, status, has_triggers
      FROM ${definitionNames} WHERE ${where} ORDER BY definition_key`,
  );
  return decodeNameRows(rows).map((row) => ({
    playbookKey: row.playbook_key,
    definitionType: row.definition_type,
    name: row.name,
    definitionKey: row.definition_key,
    status: row.status,
    hasTriggers: row.has_triggers === true || row.has_triggers === 1,
  }));
}

export async function heldBy(read: ReadQuery, definitionKey: string): Promise<HeldName | undefined> {
  return (await heldWhere(read, SQL`definition_key = ${definitionKey}`)).at(0);
}

export async function holderOf(
  read: ReadQuery,
  { playbookKey, definitionType, name }: NameInAPlaybook,
): Promise<HeldName | undefined> {
  return (
    await heldWhere(read, SQL`playbook_key = ${playbookKey} AND definition_type = ${definitionType} AND name = ${name}`)
  ).at(0);
}

export function namesOfAKind(
  read: ReadQuery,
  { playbookKey, definitionType }: Pick<DefinitionName, 'playbookKey' | 'definitionType'>,
): Promise<readonly HeldName[]> {
  return heldWhere(read, SQL`playbook_key = ${playbookKey} AND definition_type = ${definitionType}`);
}

async function holderOfStreamIn(
  read: ReadQuery,
  { playbookKey, stream }: StreamInAPlaybook,
): Promise<string | undefined> {
  const rows = await read(
    SQL`SELECT n.definition_key FROM ${definitionNames} AS n
      WHERE n.playbook_key = ${playbookKey} AND EXISTS (SELECT 1 FROM emt_streams AS s
        WHERE s.stream_id = n.definition_key || ${stream} AND s.partition = ${defaultPartition} AND s.is_archived = FALSE)
      ORDER BY n.definition_key LIMIT 1`,
  );
  return decodeHolderRows(rows).at(0)?.definition_key;
}

export function definitionNamesReadOn(read: ReadQuery): DefinitionNamesStore {
  return {
    holderOfName: (named) => holderOf(read, named),
    nameHeldBy: (definitionKey) => heldBy(read, definitionKey),
    namesHeldIn: (kind) => namesOfAKind(read, kind),
    definitionsIn: async (playbookKey) =>
      (await heldWhere(read, SQL`playbook_key = ${playbookKey}`)).map(({ definitionKey }) => definitionKey),
    holderOfStream: (named) => holderOfStreamIn(read, named),
  };
}

export function nameReleased(execute: StatementExecutor, definitionKey: string): Promise<unknown> {
  return execute.command(SQL`DELETE FROM ${definitionNames} WHERE definition_key = ${definitionKey}`);
}

export function nameWritten(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  { definitionKey, playbookKey, definitionType, name, status, hasTriggers }: HeldName,
): Promise<unknown> {
  return execute.command(
    SQL`INSERT INTO ${definitionNames} (playbook_key, definition_type, name, definition_key, status, has_triggers)
      VALUES (${playbookKey}, ${definitionType}, ${name}, ${definitionKey}, ${status}, ${dialect.booleanOf(hasTriggers)})`,
  );
}
