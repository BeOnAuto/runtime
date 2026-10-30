import type { ConnectionPorts, ReadRows, Statement } from '@on.auto/ledger';

function bindsPast(mostBoundValues: number, statements: readonly Statement[]): boolean {
  return statements.some(({ values }) => values.length > mostBoundValues);
}

function refusedPast<A>(mostBoundValues: number, statements: readonly Statement[], run: () => Promise<A>): Promise<A> {
  return bindsPast(mostBoundValues, statements)
    ? Promise.reject(new Error(`too many SQL variables: a statement binds more than ${mostBoundValues} values`))
    : run();
}

function boundedReads(read: ReadRows, mostBoundValues: number): ReadRows {
  return (statement) => refusedPast(mostBoundValues, [statement], () => read(statement));
}

export function boundedConnection(connection: ConnectionPorts, mostBoundValues: number): ConnectionPorts {
  return {
    ...connection,
    mostBoundValues,
    read: boundedReads(connection.read, mostBoundValues),
    write: (statement) => refusedPast(mostBoundValues, [statement], () => connection.write(statement)),
    transaction: (statements) => refusedPast(mostBoundValues, statements, () => connection.transaction(statements)),
    readConsistently: (reads) => connection.readConsistently((read) => reads(boundedReads(read, mostBoundValues))),
  };
}
