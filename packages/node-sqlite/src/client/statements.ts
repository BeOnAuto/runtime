import type { SQLOutputValue, StatementSync } from 'node:sqlite';

import type { QueryResult } from '@event-driven-io/dumbo';

import { rowsOf, type BoundValues } from './rows.ts';

export interface OpenDatabase {
  readonly isTransaction: boolean;
  readonly prepare: (text: string) => StatementSync;
  readonly close: () => void;
}

export type Statement = (database: OpenDatabase, text: string, values: BoundValues) => QueryResult;

export type Answering = <A>(work: () => A) => Promise<A>;

export function inTurn<A, B>(items: readonly A[], each: (item: A, place: number) => Promise<B>): Promise<B[]> {
  return items.reduce<Promise<B[]>>(
    async (earlier, item, place) => [...(await earlier), await each(item, place)],
    Promise.resolve([]),
  );
}

export function valuesOf(database: OpenDatabase, text: string): SQLOutputValue[] {
  return database
    .prepare(text)
    .all()
    .flatMap((row: Readonly<Record<string, Readonly<SQLOutputValue>>>) => Object.values(row));
}

export const queried: Statement = (database, text, values) => {
  const rows = rowsOf(database.prepare(text), values);
  return { rowCount: rows.length, rows };
};

export const commanded: Statement = (database, text, values) => {
  const [before] = valuesOf(database, 'SELECT total_changes()');
  const rows = rowsOf(database.prepare(text), values);
  const [changes, after] = valuesOf(database, 'SELECT changes(), total_changes()');
  return { rowCount: Number(after) > Number(before) ? Number(changes) : 0, rows };
};

export const ranIgnoringChanges: Statement = (database, text, values) => {
  database.prepare(text).run(...values);
  return { rowCount: 0, rows: [] };
};
