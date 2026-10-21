import { SQL } from '@event-driven-io/dumbo';

type RelationKind = 'table' | 'index';

export interface ContentDialect {
  readonly bytesType: string;
  readonly bytesOfHex: (hex: string) => SQL;
  readonly relationsAmong: (kind: RelationKind, names: readonly string[]) => SQL;
}

const postgresqlKinds: Readonly<Record<RelationKind, SQL>> = {
  table: SQL`('r', 'p')`,
  index: SQL`('i')`,
};

export const sqliteContent: ContentDialect = {
  bytesType: 'BLOB',
  bytesOfHex: (hex) => SQL`unhex(${hex})`,
  relationsAmong: (kind, names) =>
    SQL`SELECT name FROM sqlite_master WHERE type = ${kind} AND name IN (SELECT value FROM json_each(${JSON.stringify(names)}))`,
};

export const postgresqlContent: ContentDialect = {
  bytesType: 'BYTEA',
  bytesOfHex: (hex) => SQL`decode(${hex}, 'hex')`,
  relationsAmong: (kind, names) => SQL`SELECT relname AS name FROM pg_class
    WHERE relkind IN ${postgresqlKinds[kind]} AND relname IN (${SQL.merge(
      names.map((name) => SQL`${name}`),
      ', ',
    )}) AND pg_table_is_visible(oid)`,
};
