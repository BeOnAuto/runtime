import type { SQLQueryResultColumnMapping } from '@event-driven-io/dumbo';
import type { SQLiteTransactionMode } from '@event-driven-io/dumbo/sqlite';

export interface ReadonlyAbort {
  readonly signal: Readonly<AbortSignal>;
}

export interface ReadonlyAbortContext {
  readonly abort: ReadonlyAbort;
}

export interface ReadonlyAbortOptions {
  readonly abort?: ReadonlyAbort | undefined;
}

export interface ReadonlyConnectionOptions extends ReadonlyAbortOptions {
  readonly readonly?: boolean;
}

export interface ReadonlyStatementOptions extends ReadonlyAbortOptions {
  readonly timeoutMS?: number | undefined;
  readonly mapping?: Readonly<SQLQueryResultColumnMapping>;
}

export interface ReadonlyBatchCommandOptions extends ReadonlyStatementOptions {
  readonly assertChanges?: boolean;
}

export interface NodeSqliteTransactionOptions extends ReadonlyAbortOptions {
  readonly allowNestedTransactions?: boolean;
  readonly readonly?: boolean;
  readonly statementTimeoutMS?: number | undefined;
  readonly mode?: SQLiteTransactionMode;
  readonly useSavepoints?: boolean;
}
