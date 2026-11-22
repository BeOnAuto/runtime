import { statement, statementOf, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import { WholeNumber, type ChatDatabase } from './chat-database.ts';
import type { AccountLink, LinkRows, LinkStart, LinksSelected } from './chat-rows.ts';

export const linksTable = 'chat_links';

export const linkStartsTable = 'chat_link_starts';

export const linksTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS chat_links (
    account TEXT NOT NULL,
    member TEXT NOT NULL,
    person TEXT NOT NULL,
    linked_at BIGINT NOT NULL,
    PRIMARY KEY (account, member)
  )`,
  statement`CREATE INDEX IF NOT EXISTS chat_links_by_person ON chat_links (person)`,
  statement`CREATE TABLE IF NOT EXISTS chat_link_starts (
    account TEXT NOT NULL,
    member TEXT NOT NULL,
    secret TEXT NOT NULL,
    person TEXT,
    PRIMARY KEY (account, member)
  )`,
  statement`CREATE INDEX IF NOT EXISTS chat_link_starts_by_secret ON chat_link_starts (secret)`,
];

const decodeLinks = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({ account: Schema.String, member: Schema.String, person: Schema.String, linked_at: WholeNumber }),
  ),
);

const decodeStarts = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      account: Schema.String,
      member: Schema.String,
      secret: Schema.String,
      person: Schema.NullOr(Schema.String),
    }),
  ),
);

function startIn(rows: unknown): LinkStart | undefined {
  const [row] = decodeStarts(rows);
  if (row === undefined) {
    return undefined;
  }
  const { account, member, secret, person } = row;
  return person === null ? { account, member, secret } : { account, member, secret, person };
}

function linkIn(rows: unknown): AccountLink | undefined {
  const [row] = decodeLinks(rows);
  return row === undefined
    ? undefined
    : { account: row.account, member: row.member, person: row.person, linkedAt: row.linked_at };
}

type Condition = readonly [column: 'account' | 'member' | 'person', value: string];

function conditionsOf(selected: LinksSelected): readonly [Condition, ...Condition[]] {
  if ('person' in selected) {
    return [['person', selected.person]];
  }
  return 'member' in selected
    ? [
        ['account', selected.account],
        ['member', selected.member],
      ]
    : [['account', selected.account]];
}

function deletedFrom(table: 'chat_links' | 'chat_link_starts', selected: LinksSelected): Statement {
  const [[first, value], ...rest] = conditionsOf(selected);
  return statementOf(
    [`DELETE FROM ${table} WHERE ${first} = `, ...rest.map(([column]) => ` AND ${column} = `), ' RETURNING member'],
    [value, ...rest.map(([, each]) => each)],
  );
}

function startsOver(database: ChatDatabase): Pick<LinkRows, 'started' | 'startFound' | 'startOf' | 'startEnded'> {
  return {
    started: async ({ account, member, secret, person = null }) => {
      await database.write(statement`INSERT INTO chat_link_starts (account, member, secret, person)
        VALUES (${account}, ${member}, ${secret}, ${person})
        ON CONFLICT (account, member) DO UPDATE SET secret = excluded.secret, person = excluded.person`);
    },
    startFound: async (secret) =>
      startIn(
        await database.read(statement`SELECT account, member, secret, person FROM chat_link_starts
          WHERE secret = ${secret} ORDER BY account, member LIMIT 1`),
      ),
    startOf: async ({ account, member }) =>
      startIn(
        await database.read(statement`SELECT account, member, secret, person FROM chat_link_starts
          WHERE account = ${account} AND member = ${member}`),
      ),
    startEnded: async ({ account, member, secret }) => {
      const deleted = await database.write(statement`DELETE FROM chat_link_starts
        WHERE account = ${account} AND member = ${member} AND secret = ${secret} RETURNING member`);
      return deleted.length === 1;
    },
  };
}

export function storedLinks(database: ChatDatabase): LinkRows {
  const deleted = async (table: 'chat_links' | 'chat_link_starts', selected: LinksSelected) =>
    (await database.write(deletedFrom(table, selected))).length > 0;
  return {
    ...startsOver(database),
    linked: async ({ account, member, person, linkedAt }) => {
      await database.write(statement`INSERT INTO chat_links (account, member, person, linked_at)
        VALUES (${account}, ${member}, ${person}, ${linkedAt})
        ON CONFLICT (account, member) DO UPDATE SET person = excluded.person, linked_at = excluded.linked_at`);
    },
    linkOf: async ({ account, member }) =>
      linkIn(
        await database.read(statement`SELECT account, member, person, linked_at FROM chat_links
          WHERE account = ${account} AND member = ${member}`),
      ),
    personForgotten: async (person) => {
      await deleted('chat_link_starts', { person });
      await deleted('chat_links', { person });
    },
    linksDeleted: (selected) => deleted('chat_links', selected),
    startsDeleted: (selected) => deleted('chat_link_starts', selected),
  };
}
