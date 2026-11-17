import type { SQL } from '@event-driven-io/dumbo';
import { noHoldersKnown, streamPrefixOfOrg, type ContentHolders } from '@on.auto/operations';

import type { InTransaction, StatementExecutor, UnlessHeld } from '../event-store.ts';
import { tableKept, type Preparation } from '../projection-checkpoints/projection-checkpoints.ts';
import { inlineRegistrationOf, inTurn, type InlineRegistration } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { mostBytesInABatch, versionOfTable, type NamedProjection } from '../projections/projection-fill.ts';
import type { HeldHeads } from './held-heads.ts';
import { keepingReferences, referencesFilled, referencesRefolded, type ReferencesKeeping } from './references-folds.ts';
import { contentReferences, digestsLocked, firstHeldHeads, isHeldIn, referencesCreated } from './references-table.ts';

export interface ContentReferences {
  readonly named: readonly NamedProjection[];
  readonly registrations: readonly InlineRegistration[];
  readonly prepare: (preparation: Preparation) => Promise<void>;
  readonly refolded: (execute: StatementExecutor, stream: string) => Promise<void>;
  readonly unlessHeldOn: (inTransaction: InTransaction) => UnlessHeld;
  readonly heldHeadsOn: (read: (sql: SQL) => Promise<readonly unknown[]>) => HeldHeads;
}

function isEarlierVersion(table: string): boolean {
  const version = versionOfTable(contentReferences, table);
  return version !== undefined && version < contentReferences.version;
}

async function created(keeping: ReferencesKeeping, execute: StatementExecutor): Promise<void> {
  await inTurn(referencesCreated(keeping.dialect), (statement) => execute.command(statement));
  await referencesFilled(keeping, execute);
}

function prepared(keeping: ReferencesKeeping, preparation: Preparation): Promise<void> {
  return tableKept(
    {
      dialect: keeping.dialect,
      projection: contentReferences,
      isEarlier: isEarlierVersion,
      made: (transaction) => created(keeping, transaction),
    },
    preparation,
  );
}

function referencesKept(keeping: ReferencesKeeping): ContentReferences {
  return {
    named: [contentReferences],
    registrations: keeping.holders.size === 0 ? [] : [inlineRegistrationOf(keepingReferences(keeping))],
    prepare: (preparation) => prepared(keeping, preparation),
    refolded: (execute, stream) => referencesRefolded(keeping, execute, stream),
    unlessHeldOn: (inTransaction) => (owner, sha256, within) =>
      inTransaction(async (execute) => {
        const orgKey = streamPrefixOfOrg(owner);
        await digestsLocked(execute, keeping.dialect, orgKey, [sha256]);
        return (await isHeldIn(execute, orgKey, sha256)) ? 'held' : within(execute);
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
