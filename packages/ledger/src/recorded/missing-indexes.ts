import type { SQL } from '@event-driven-io/dumbo';

export interface IndexExecutor {
  readonly query: (sql: SQL) => Promise<{ readonly rows: readonly unknown[] }>;
  readonly command: (sql: SQL) => Promise<unknown>;
}

export interface PlaybookIndex {
  readonly name: string;
  readonly create: () => SQL;
}

async function createEach(execute: IndexExecutor, indexes: readonly PlaybookIndex[]): Promise<number> {
  const [first, ...rest] = indexes;
  if (first === undefined) {
    return 0;
  }
  await execute.command(first.create());
  return 1 + (await createEach(execute, rest));
}

export function createMissingIndexes(
  execute: IndexExecutor,
  indexes: readonly PlaybookIndex[],
  existing: ReadonlySet<string>,
): Promise<number> {
  return createEach(
    execute,
    indexes.filter(({ name }) => !existing.has(name)),
  );
}
