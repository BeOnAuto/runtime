import type { ConnectionPorts, LedgerStreams, ReadRows, Statement } from '@on.auto/ledger';
import { Data, Effect, Schema } from 'effect';

export class DatabaseFailed extends Data.TaggedError('database_failed')<{ readonly detail: string }> {}

export type ReadStatement = (statement: Statement) => Effect.Effect<readonly unknown[], DatabaseFailed>;

export interface HostDatabase {
  readonly store: LedgerStreams;
  readonly read: ReadStatement;
  readonly write: (statement: Statement) => Effect.Effect<readonly unknown[], DatabaseFailed>;
  readonly transaction: (statements: readonly Statement[]) => Effect.Effect<readonly unknown[], DatabaseFailed>;
  readonly readConsistently: <A, E>(
    reads: (read: ReadStatement) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | DatabaseFailed>;
  readonly sharedClock: Effect.Effect<number, DatabaseFailed> | null;
  readonly mostBoundValues: number;
}

export const WholeNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

function failedWith(error: unknown): DatabaseFailed {
  return new DatabaseFailed({ detail: String(error) });
}

function asked<A>(answered: () => Promise<A>): Effect.Effect<A, DatabaseFailed> {
  return Effect.tryPromise({ try: answered, catch: failedWith });
}

function readsOn(read: ReadRows): ReadStatement {
  return (statement) => asked(() => read(statement));
}

function consistentReadsOn(connection: ConnectionPorts): HostDatabase['readConsistently'] {
  return (reads) =>
    Effect.flatMap(Effect.context(), (context) =>
      Effect.flatten(
        Effect.tryPromise({
          try: (signal) =>
            connection.readConsistently((read) => Effect.runPromiseExitWith(context)(reads(readsOn(read)), { signal })),
          catch: failedWith,
        }),
      ),
    );
}

export function hostDatabaseOn(connection: ConnectionPorts): HostDatabase {
  const { sharedClock, mostBoundValues } = connection;
  return {
    store: connection.streams,
    read: readsOn(connection.read),
    write: readsOn(connection.write),
    transaction: (statements) => asked(() => connection.transaction(statements)),
    readConsistently: consistentReadsOn(connection),
    sharedClock: sharedClock === null ? null : asked(sharedClock),
    mostBoundValues,
  };
}

export function rowsOf<Row>(
  rowSchema: Schema.Codec<Row, unknown>,
  rows: Effect.Effect<readonly unknown[], DatabaseFailed>,
): Effect.Effect<readonly Row[], DatabaseFailed> {
  const decode = Schema.decodeUnknownEffect(Schema.Array(rowSchema));
  return Effect.flatMap(rows, (found) => Effect.orDie(decode(found)));
}

export function oneRowOf<Row>(
  rowSchema: Schema.Codec<Row, unknown>,
  rows: Effect.Effect<readonly unknown[], DatabaseFailed>,
): Effect.Effect<Row, DatabaseFailed> {
  const decode = Schema.decodeUnknownEffect(Schema.Tuple([rowSchema]));
  return Effect.flatMap(rows, (found) => Effect.orDie(decode(found))).pipe(Effect.map(([row]) => row));
}
