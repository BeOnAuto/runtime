import { SQL } from '@event-driven-io/dumbo';
import type { ExpiredErased } from '@on.auto/content';
import { playbookOfStreamPrefix, randomUUIDv7, uuidV7TimeOf } from '@on.auto/operations';
import { Context, Effect, Option, Schema } from 'effect';

import type { LedgerContent, OwnContentStore, StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { HeldContentUnchecked, type HeldHead, type HeldHeads } from '../references/held-heads.ts';
import { dueBy, keptExternally, keptInTheLedger, keptShelf, shelves, type Shelf } from './content-tables.ts';

export const unnamedChunksLastMs = 3_600_000;

export interface ContentSweeping {
  readonly sweepContent: (before: number) => Promise<void>;
}

export interface ChorePorts {
  readonly sweepOrphans: (now: number) => Effect.Effect<number>;
  readonly eraseExpired: (most: number) => Effect.Effect<ExpiredErased>;
  readonly heldContentFound: (most: number) => Effect.Effect<HeldContentFound, HeldContentUnchecked>;
  readonly endWaits: Effect.Effect<void>;
}

export class LedgerChores extends Context.Service<LedgerChores, ChorePorts>()('@on.auto/ledger/LedgerChores') {}

export function unnamedChunksSwept({ chunks, heads, placeColumns }: Shelf, before: string): SQL {
  const sameUpload = SQL.merge(
    [...placeColumns, 'upload_id'].map(
      (column) =>
        SQL`${SQL.identifier(heads)}.${SQL.identifier(column)} = ${SQL.identifier(chunks)}.${SQL.identifier(column)}`,
    ),
    ' AND ',
  );
  return SQL`DELETE FROM ${SQL.identifier(chunks)} WHERE substr(upload_id, 1, 8) || substr(upload_id, 10, 4) < ${before}
      AND NOT EXISTS (SELECT 1 FROM ${SQL.identifier(heads)} WHERE ${sameUpload})`;
}

function sweptShelf(execute: StatementExecutor, shelf: Shelf, before: string): Promise<unknown> {
  return execute.command(unnamedChunksSwept(shelf, before));
}

export function contentSweepOn(execute: StatementExecutor): ContentSweeping['sweepContent'] {
  return (before) => inTurn(shelves, (shelf) => sweptShelf(execute, shelf, uuidV7TimeOf(before)));
}

export function orphansSweptOf({ sweepContent }: ContentSweeping): ChorePorts['sweepOrphans'] {
  return (now) =>
    Effect.uninterruptible(
      Effect.promise(() => sweepContent(now - unnamedChunksLastMs)).pipe(
        Effect.catchCause((cause) =>
          Effect.logError(
            'The ledger could not sweep what puts that never finished left of their content; it sweeps again in an hour',
            cause,
          ),
        ),
        Effect.as(now + unnamedChunksLastMs),
      ),
    );
}

const heads = SQL.identifier(keptShelf.heads);

const ExpiredRows = Schema.Array(
  Schema.Struct({ playbook_key: Schema.String, sha256: Schema.String, upload_id: Schema.String }),
);

const ErasedRows = Schema.Array(Schema.Struct({ upload_id: Schema.String }));

type Expired = (typeof ExpiredRows.Type)[number];

export function ownExpiredRead(now: number, most: number): SQL {
  return SQL`SELECT playbook_key, sha256, upload_id FROM ${heads}
    WHERE ${dueBy(now)} AND kept_in = ${keptInTheLedger}
    ORDER BY expires_at LIMIT ${most}`;
}

async function erasedOnce(execute: StatementExecutor, expired: Expired, now: number): Promise<number> {
  const { playbook_key, sha256, upload_id } = expired;
  const { rows } = await execute.query(
    SQL`UPDATE ${heads} SET erased_at = ${now}, expires_at = NULL, upload_id = ${randomUUIDv7()}
      WHERE playbook_key = ${playbook_key} AND sha256 = ${sha256} AND upload_id = ${upload_id}
        AND kept_in = ${keptInTheLedger} AND ${dueBy(now)}
      RETURNING upload_id`,
  );
  const erased = Schema.decodeUnknownSync(ErasedRows)(rows);
  await inTurn(erased.length > 0 ? [upload_id] : [], (upload) =>
    execute.command(
      SQL`DELETE FROM ${SQL.identifier(keptShelf.chunks)} WHERE playbook_key = ${playbook_key} AND upload_id = ${upload}`,
    ),
  );
  return erased.length;
}

export function ownExpiredErasedOn(execute: StatementExecutor): OwnContentStore['eraseExpired'] {
  return async (now, most): Promise<ExpiredErased> => {
    const expired = Schema.decodeUnknownSync(ExpiredRows)((await execute.query(ownExpiredRead(now, most))).rows);
    const erasures: number[] = [];
    await inTurn(expired, async (head) => {
      erasures.push(await erasedOnce(execute, head, now));
    });
    return { erased: erasures.reduce((total, erased) => total + erased, 0), more: expired.length === most };
  };
}

export interface HeldContentFound {
  readonly checked: number;
  readonly keptElsewhere: number;
  readonly missing: number;
}

type Finding = 'found' | 'kept elsewhere' | 'missing';

interface HeldContentLooking {
  readonly heldHeads: HeldHeads;
  readonly kept: Pick<LedgerContent, 'found'>;
  readonly outside: boolean;
}

function notFoundAs({ keptIn }: HeldHead, outside: boolean): Finding {
  const keptHere = outside ? keptExternally : keptInTheLedger;
  return keptIn === undefined || keptIn === keptHere ? 'missing' : 'kept elsewhere';
}

function findingOf(
  { kept, outside }: HeldContentLooking,
  head: HeldHead,
): Effect.Effect<Finding, HeldContentUnchecked> {
  return Option.match(playbookOfStreamPrefix(head.playbookKey), {
    onNone: () => Effect.succeed<Finding>('missing'),
    onSome: (playbook) =>
      kept.found(playbook, head.sha256).pipe(
        Effect.map((found): Finding => (found ? 'found' : notFoundAs(head, outside))),
        Effect.catchDefect((failure) => Effect.fail(new HeldContentUnchecked({ failure }))),
      ),
  });
}

export function heldContentFoundBy(
  looking: HeldContentLooking,
): (most: number) => Effect.Effect<HeldContentFound, HeldContentUnchecked> {
  return (most) =>
    Effect.gen(function* () {
      const held = yield* Effect.promise(() => looking.heldHeads(most));
      const findings = yield* Effect.forEach(held, (head) => findingOf(looking, head), { concurrency: 'unbounded' });
      return {
        checked: findings.length,
        keptElsewhere: findings.filter((finding) => finding === 'kept elsewhere').length,
        missing: findings.filter((finding) => finding === 'missing').length,
      };
    });
}
