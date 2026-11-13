import { SQL } from '@event-driven-io/dumbo';
import { noHoldersKnown, streamPrefixOfPlaybook, type ContentHolders } from '@on.auto/operations';

import type { InTransaction, StatementExecutor, UnlessHeld } from '../event-store.ts';
import { inlineRegistrationOf, inTurn, type InlineRegistration } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { mostBytesInABatch, versionOfTable, type NamedProjection } from '../projections/projection-fill.ts';
import { namesIn, tableDrop } from '../projections/projection-statements.ts';
import type { HeldHeads } from './held-heads.ts';
import { keepingReferences, referencesFilled, referencesRefolded, type ReferencesKeeping } from './references-folds.ts';
import {
  contentReferences,
  digestsLocked,
  firstHeldHeads,
  isHeldIn,
  referencesCreated,
  referencesTable,
} from './references-table.ts';

export interface ContentReferences {
  readonly named: readonly NamedProjection[];
  readonly registrations: readonly InlineRegistration[];
  readonly prepare: (execute: StatementExecutor, inTransaction: InTransaction) => Promise<void>;
  readonly refolded: (execute: StatementExecutor, stream: string) => Promise<void>;
  readonly unlessHeldOn: (inTransaction: InTransaction) => UnlessHeld;
  readonly heldHeadsOn: (read: (sql: SQL) => Promise<readonly unknown[]>) => HeldHeads;
}

function isEarlierVersion(table: string): boolean {
  const version = versionOfTable(contentReferences, table);
  return version !== undefined && version < contentReferences.version;
}

async function created(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  tables: readonly string[],
): Promise<void> {
  await inTurn(referencesCreated(keeping.dialect), (statement) => execute.command(statement));
  await referencesFilled(keeping, execute);
  await inTurn(
    tables.filter((table) => isEarlierVersion(table)),
    (name) => execute.command(tableDrop(name)),
  );
  await execute.command(SQL`ANALYZE ${SQL.plain(referencesTable)}`);
}

async function prepared(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  inTransaction: InTransaction,
): Promise<void> {
  const tables = await namesIn(execute, keeping.dialect.tableVersions(contentReferences.name));
  if (!tables.includes(referencesTable)) {
    await inTransaction((transaction) => created(keeping, transaction, tables));
  }
}

function referencesKept(keeping: ReferencesKeeping): ContentReferences {
  return {
    named: [contentReferences],
    registrations: keeping.holders.size === 0 ? [] : [inlineRegistrationOf(keepingReferences(keeping))],
    prepare: (execute, inTransaction) => prepared(keeping, execute, inTransaction),
    refolded: (execute, stream) => referencesRefolded(keeping, execute, stream),
    unlessHeldOn: (inTransaction) => (playbook, sha256, within) =>
      inTransaction(async (execute) => {
        const prefix = streamPrefixOfPlaybook(playbook);
        await digestsLocked(execute, keeping.dialect, prefix, [sha256]);
        return (await isHeldIn(execute, prefix, sha256)) ? 'held' : within(execute);
      }),
    heldHeadsOn: (read) => (most) => firstHeldHeads(read, most),
  };
}

const noReferences: ContentReferences = {
  named: [],
  registrations: [],
  prepare: () => Promise.resolve(),
  refolded: () => Promise.resolve(),
  unlessHeldOn: () => () => Promise.reject(noHoldersKnown()),
  heldHeadsOn: () => () => Promise.reject(noHoldersKnown()),
};

export function contentReferencesOf(
  dialect: ProjectionDialect,
  holders: ContentHolders | undefined,
  mostBytes: number = mostBytesInABatch,
): ContentReferences {
  return holders === undefined ? noReferences : referencesKept({ dialect, holders, mostBytes });
}
