import { SQL } from '@event-driven-io/dumbo';
import type { Conflict, ProjectedMessage } from '@on.auto/operations';
import { Schema } from 'effect';

import { playbookKeyOfStream } from '../appends/append-signal.ts';
import type { StatementExecutor } from '../event-store.ts';
import {
  inlineRegistrationOf,
  inTurn,
  type InlineRegistration,
  type StoredMessage,
} from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { appendRefusedAs } from '../refusals/append-refused.ts';
import { definitionNames, definitionNamesTableName } from './definition-names-table.ts';

export interface DefinitionName {
  readonly playbookKey: string;
  readonly definitionType: string;
  readonly name: string;
  readonly status: string;
  readonly hasTriggers: boolean;
}

export interface DefinitionNames {
  readonly types: readonly string[];
  readonly nameAfter: (held: DefinitionName | undefined, message: ProjectedMessage) => DefinitionName | undefined;
  readonly takenBy: (claimed: DefinitionName, holder: DefinitionName) => Conflict;
}

interface HeldName extends DefinitionName {
  readonly definitionKey: string;
}

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

async function heldWhere(execute: StatementExecutor, where: SQL): Promise<HeldName | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT playbook_key, definition_type, name, definition_key, status, has_triggers
      FROM ${definitionNames} WHERE ${where}`,
  );
  return decodeNameRows(rows)
    .map((row) => ({
      playbookKey: row.playbook_key,
      definitionType: row.definition_type,
      name: row.name,
      definitionKey: row.definition_key,
      status: row.status,
      hasTriggers: row.has_triggers === true || row.has_triggers === 1,
    }))
    .at(0);
}

function nameKeyOf({ definitionType, name }: DefinitionName): string {
  return `${definitionType}/${name}`;
}

function isTheSameName(held: DefinitionName | undefined, claimed: DefinitionName): boolean {
  return (
    held !== undefined &&
    held.playbookKey === claimed.playbookKey &&
    held.definitionType === claimed.definitionType &&
    held.name === claimed.name
  );
}

interface NamesKeeping {
  readonly dialect: ProjectionDialect;
  readonly names: DefinitionNames;
}

async function nameFreeFor(
  { dialect, names }: NamesKeeping,
  execute: StatementExecutor,
  definitionKey: string,
  claimed: DefinitionName,
): Promise<void> {
  await inTurn(dialect.keyLocks(definitionNamesTableName, claimed.playbookKey, nameKeyOf(claimed)), (lock) =>
    execute.query(lock),
  );
  const holder = await heldWhere(
    execute,
    SQL`playbook_key = ${claimed.playbookKey} AND definition_type = ${claimed.definitionType} AND name = ${claimed.name}`,
  );
  if (holder !== undefined && holder.definitionKey !== definitionKey) {
    throw appendRefusedAs(names.takenBy(claimed, holder));
  }
}

async function nameKept(
  { dialect }: NamesKeeping,
  execute: StatementExecutor,
  definitionKey: string,
  { playbookKey, definitionType, name, status, hasTriggers }: DefinitionName,
): Promise<void> {
  await execute.command(SQL`DELETE FROM ${definitionNames} WHERE definition_key = ${definitionKey}`);
  await execute.command(
    SQL`INSERT INTO ${definitionNames} (playbook_key, definition_type, name, definition_key, status, has_triggers)
      VALUES (${playbookKey}, ${definitionType}, ${name}, ${definitionKey}, ${status}, ${dialect.booleanOf(hasTriggers)})`,
  );
}

async function nameAfterThe(
  keeping: NamesKeeping,
  execute: StatementExecutor,
  { stream, id, position, type, data, context }: StoredMessage,
): Promise<void> {
  const definitionKey = playbookKeyOfStream(stream);
  if (definitionKey === undefined) {
    return;
  }
  await inTurn(keeping.dialect.keyLocks(definitionNamesTableName, definitionKey, ''), (lock) => execute.query(lock));
  const held = await heldWhere(execute, SQL`definition_key = ${definitionKey}`);
  const claimed = keeping.names.nameAfter(held, {
    id,
    position,
    type,
    data: keeping.dialect.appendedData(data),
    context,
  });
  if (claimed === undefined) {
    return;
  }
  if (!isTheSameName(held, claimed)) {
    await nameFreeFor(keeping, execute, definitionKey, claimed);
  }
  await nameKept(keeping, execute, definitionKey, claimed);
}

export function definitionNamesRegistrations(
  dialect: ProjectionDialect,
  names: DefinitionNames | undefined,
): readonly InlineRegistration[] {
  if (names === undefined) {
    return [];
  }
  const keeping = { dialect, names };
  return [
    inlineRegistrationOf({
      types: names.types,
      handle: (messages, execute) => inTurn(messages, (message) => nameAfterThe(keeping, execute, message)),
    }),
  ];
}
