import { DatabaseSync } from 'node:sqlite';

import { BatchCommandNoChangesError, type JSONSerializer, type QueryResult, type SQL } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  mapSqliteError,
  sqliteFormatter,
  type SQLitePragmaOptions,
} from '@event-driven-io/dumbo/sqlite';

import { boundValuesOf } from './binding.ts';
import { waitedForTheLock } from './busy-handler.ts';
import { connectedWith } from './connecting.ts';
import { onTheNextTurn } from './next-turn.ts';
import { pragmasOf } from './pragmas.ts';
import { sqliteErrorOf } from './result-codes.ts';
import { commanded, inTurn, queried, ranIgnoringChanges, type Answering, type Statement } from './statements.ts';

export interface NodeSqliteClientOptions {
  readonly fileName?: string;
  readonly connectionString?: string;
  readonly pragmaOptions?: Readonly<Partial<SQLitePragmaOptions>>;
  readonly skipDatabasePragmas?: boolean;
  readonly minimumSQLiteVersion?: string;
  readonly serializer: JSONSerializer;
}

export interface CommandOptions {
  readonly ignoreChangesCount?: boolean;
}

export interface BatchCommandOptions extends CommandOptions {
  readonly assertChanges?: boolean;
}

export interface NodeSqliteClient {
  readonly connect: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly query: (sql: SQL) => Promise<QueryResult>;
  readonly batchQuery: (sqls: Iterable<SQL>) => Promise<QueryResult[]>;
  readonly command: (sql: SQL, options?: CommandOptions) => Promise<QueryResult>;
  readonly batchCommand: (sqls: Iterable<SQL>, options?: BatchCommandOptions) => Promise<QueryResult[]>;
}

export function locationOf({ fileName, connectionString }: Omit<NodeSqliteClientOptions, 'serializer'>): string {
  return fileName ?? connectionString ?? InMemorySQLiteDatabase;
}

async function mappedAsTheLibraryMapsSQLiteErrors<A>(work: () => Promise<A>): Promise<A> {
  try {
    return await work();
  } catch (error: unknown) {
    throw mapSqliteError(sqliteErrorOf(error));
  }
}

function statementOf({ ignoreChangesCount }: CommandOptions): Statement {
  return ignoreChangesCount === true ? ranIgnoringChanges : commanded;
}

function changesAsserted(
  { rowCount }: Pick<QueryResult, 'rowCount'>,
  place: number,
  { assertChanges }: BatchCommandOptions,
): void {
  if (assertChanges === true && rowCount === 0) {
    throw new BatchCommandNoChangesError(place);
  }
}

export function nodeSqliteClient(options: NodeSqliteClientOptions): NodeSqliteClient {
  const pragmas = pragmasOf(locationOf(options), options.pragmaOptions);
  const database = new DatabaseSync(locationOf(options), { open: false, timeout: 0 });
  const lockWait = { busyTimeout: pragmas.busyTimeout, inATransaction: () => database.isTransaction };
  const answered: Answering = (work) => waitedForTheLock(() => onTheNextTurn(work), lockWait);
  const answerOf = (sql: SQL, statement: Statement): Promise<QueryResult> => {
    const { query, params } = sqliteFormatter.format(sql, { serializer: options.serializer });
    const values = boundValuesOf(params);
    return answered(() => statement(database, query, values));
  };
  const commandOf = (sql: SQL, commandOptions: CommandOptions): Promise<QueryResult> =>
    answerOf(sql, statementOf(commandOptions));
  const batchCommandOf = async (sql: SQL, batchOptions: BatchCommandOptions, place: number): Promise<QueryResult> => {
    const answer = await commandOf(sql, batchOptions);
    changesAsserted(answer, place, batchOptions);
    return answer;
  };
  const connected = (): Promise<void> => {
    database.open();
    return connectedWith({ ...options, database, answered, pragmas });
  };
  return {
    connect: () => (database.isOpen ? Promise.resolve() : mappedAsTheLibraryMapsSQLiteErrors(connected)),
    close: () => {
      if (database.isOpen) {
        database.close();
      }
      return Promise.resolve();
    },
    query: (sql) => mappedAsTheLibraryMapsSQLiteErrors(() => answerOf(sql, queried)),
    batchQuery: (sqls) => mappedAsTheLibraryMapsSQLiteErrors(() => inTurn([...sqls], (sql) => answerOf(sql, queried))),
    command: (sql, commandOptions = {}) => mappedAsTheLibraryMapsSQLiteErrors(() => commandOf(sql, commandOptions)),
    batchCommand: (sqls, batchOptions = {}) =>
      mappedAsTheLibraryMapsSQLiteErrors(() =>
        inTurn([...sqls], (sql, place) => batchCommandOf(sql, batchOptions, place)),
      ),
  };
}
