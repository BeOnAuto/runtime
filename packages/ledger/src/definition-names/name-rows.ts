import { SQL } from '@event-driven-io/dumbo';
import type { DefinitionName, HeldName } from '@on.auto/operations/definition-names';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
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

async function heldWhere(execute: StatementExecutor, where: SQL): Promise<readonly HeldName[]> {
  const { rows } = await execute.query(
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

export async function heldBy(execute: StatementExecutor, definitionKey: string): Promise<HeldName | undefined> {
  return (await heldWhere(execute, SQL`definition_key = ${definitionKey}`)).at(0);
}

export async function holderOf(
  execute: StatementExecutor,
  { playbookKey, definitionType, name }: DefinitionName,
): Promise<HeldName | undefined> {
  return (
    await heldWhere(
      execute,
      SQL`playbook_key = ${playbookKey} AND definition_type = ${definitionType} AND name = ${name}`,
    )
  ).at(0);
}

export function namesOfAKind(
  execute: StatementExecutor,
  { playbookKey, definitionType }: Pick<DefinitionName, 'playbookKey' | 'definitionType'>,
): Promise<readonly HeldName[]> {
  return heldWhere(execute, SQL`playbook_key = ${playbookKey} AND definition_type = ${definitionType}`);
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
