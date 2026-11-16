import { SQL } from '@event-driven-io/dumbo';
import type {
  ContentHeads,
  ContentOwner,
  ErasureTimes,
  ExpiredContent,
  HeadKept,
  HeadMarked,
  HeadToKeep,
  KeptContentHead,
  RemovalTimes,
} from '@on.auto/content';
import { orgOfStreamPrefix, randomUUIDv7 } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import type { ReturningExecutor, StatementExecutor, UnlessHeld } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import {
  dueBy,
  expiryKept,
  expiryKeptOver,
  expiryOfThePut,
  keptExternally,
  keptHeadColumns,
  keptHeadIn,
  keptShelf,
  laterExpiry,
  orgKeyOf,
  placeRecorded,
  placesRead,
  theContent,
} from './content-tables.ts';

interface HeadKeeping {
  readonly owner: ContentOwner;
  readonly sha256: string;
  readonly head: HeadToKeep;
  readonly keptAt: number;
}

const heads = SQL.identifier(keptShelf.heads);

const chunks = SQL.identifier(keptShelf.chunks);

const places = SQL.identifier(keptShelf.places);

const markedAloneBy = '';

const HeadRow = Schema.Struct({
  upload_id: Schema.String,
  bytes: Schema.Number,
  media_type: Schema.String,
  removing_since: Schema.NullOr(Schema.Number),
  expires_at: Schema.NullOr(Schema.Number),
});

const OneHead = Schema.Tuple([HeadRow]);

const HeadRows = Schema.Array(HeadRow);

const RemovingRows = Schema.Array(Schema.Struct({ removing_since: Schema.NullOr(Schema.Number) }));

const ExpiredRows = Schema.Array(Schema.Struct({ org_key: Schema.String, sha256: Schema.String }));

const MarkedRows = Schema.Array(Schema.Struct({ removing_since: Schema.Number }));

const UploadRows = Schema.Array(Schema.Struct({ place_key: Schema.String, upload_id: Schema.String }));

const headColumns = SQL.plain(
  'upload_id, CAST(bytes AS DOUBLE PRECISION) AS bytes, media_type, CAST(removing_since AS DOUBLE PRECISION) AS removing_since, CAST(expires_at AS DOUBLE PRECISION) AS expires_at',
);

const takenOverColumns = ['place_key', 'bytes', 'chunks', 'media_type', 'kept_in'];

export const placeOfNewBytesOf: (owner: ContentOwner) => string = orgKeyOf;

function keptAs(row: typeof HeadRow.Type, putBy: string): HeadKept {
  if (row.removing_since !== null) {
    const since = row.removing_since;
    return row.expires_at === null
      ? { kept: 'removing', since }
      : { kept: 'removing', since, expiresAt: row.expires_at };
  }
  return { kept: row.upload_id === putBy ? 'new' : 'standing', head: { bytes: row.bytes, mediaType: row.media_type } };
}

function erasedTakenOver(): SQL {
  const erasedAlone = SQL`${heads}.removing_since IS NULL AND ${heads}.erased_at IS NOT NULL`;
  return SQL.merge(
    takenOverColumns.map(
      (column) =>
        SQL`${SQL.identifier(column)} = CASE WHEN ${erasedAlone} THEN excluded.${SQL.identifier(column)} ELSE ${heads}.${SQL.identifier(column)} END`,
    ),
    ', ',
  );
}

function headInserted({ owner, sha256, head, keptAt }: HeadKeeping, putBy: string, withExpiry: boolean): SQL {
  const columns = SQL.plain(
    `org_key, sha256, place_key, upload_id, bytes, chunks, media_type, kept_at, kept_in${withExpiry ? ', expires_at' : ''}`,
  );
  const values = [
    SQL`${orgKeyOf(owner)}, ${sha256}, ${placeOfNewBytesOf(owner)}, ${putBy}, ${head.bytes}, 0, ${head.mediaType}, ${keptAt}, ${keptExternally}`,
    ...(withExpiry ? [expiryOfThePut(head.expiresAt)] : []),
  ];
  return SQL`INSERT INTO ${heads} (${columns}) VALUES (${SQL.merge(values, ', ')})`;
}

const keptAtUnlessRemoving = SQL`kept_at = CASE WHEN ${heads}.removing_since IS NULL THEN excluded.kept_at ELSE ${heads}.kept_at END`;

function keptUnlessErased(keeping: HeadKeeping, putBy: string): SQL {
  const { expiresAt } = keeping.head;
  const later = laterExpiry(SQL`${heads}.expires_at`, SQL`excluded.expires_at`);
  return SQL`${headInserted(keeping, putBy, expiresAt !== undefined)}
    ON CONFLICT (org_key, sha256) DO UPDATE SET ${keptAtUnlessRemoving},
      expires_at = CASE WHEN ${heads}.removing_since IS NULL THEN ${expiresAt === undefined ? SQL`NULL` : later} ELSE ${heads}.expires_at END
    WHERE ${heads}.erased_at IS NULL OR ${heads}.removing_since IS NOT NULL
    RETURNING ${headColumns}`;
}

function keptOverAnErased(keeping: HeadKeeping, putBy: string): SQL {
  return SQL`${headInserted(keeping, putBy, true)}
    ON CONFLICT (org_key, sha256) DO UPDATE SET ${keptAtUnlessRemoving},
      expires_at = CASE WHEN ${heads}.removing_since IS NULL THEN ${expiryKeptOver(keptShelf.heads)} ELSE ${heads}.expires_at END,
      ${erasedTakenOver()},
      erased_at = CASE WHEN ${heads}.removing_since IS NULL THEN NULL ELSE ${heads}.erased_at END
    RETURNING ${headColumns}`;
}

function keptBy(execute: ReturningExecutor, keeping: HeadKeeping): Effect.Effect<HeadKept> {
  const putBy = randomUUIDv7();
  const rowsOf = async (sql: SQL) => (await execute.command(sql)).rows;
  return Effect.promise(async () => {
    const standing = Schema.decodeUnknownSync(HeadRows)(await rowsOf(keptUnlessErased(keeping, putBy))).at(0);
    const row = standing ?? Schema.decodeUnknownSync(OneHead)(await rowsOf(keptOverAnErased(keeping, putBy)))[0];
    return keptAs(row, putBy);
  });
}

interface Touch {
  readonly keptAt: number;
  readonly expiresAt: number | undefined;
}

function touchedBy(
  execute: ReturningExecutor,
  digest: SQL,
  { keptAt, expiresAt }: Touch,
): Effect.Effect<HeadKept | undefined> {
  const expiry = expiryKept(SQL`expires_at`, expiresAt);
  return Effect.promise(async () => {
    const { rows } = await execute.command(
      SQL`UPDATE ${heads} SET kept_at = CASE WHEN removing_since IS NULL THEN ${keptAt} ELSE kept_at END,
          expires_at = CASE WHEN removing_since IS NULL THEN ${expiry} ELSE expires_at END
        WHERE ${digest} AND erased_at IS NULL RETURNING ${headColumns}`,
    );
    const row = Schema.decodeUnknownSync(HeadRows)(rows).at(0);
    return row === undefined ? undefined : keptAs(row, '');
  });
}

async function markedAlone(
  execute: StatementExecutor,
  owner: ContentOwner,
  sha256: string,
  now: number,
): Promise<boolean> {
  const { rows } = await execute.query(
    SQL`INSERT INTO ${heads} (org_key, sha256, place_key, upload_id, bytes, chunks, media_type, kept_at, kept_in, removing_since)
      VALUES (${orgKeyOf(owner)}, ${sha256}, ${placeOfNewBytesOf(owner)}, ${markedAloneBy}, 0, 0, '', 0, ${keptExternally}, ${now})
      ON CONFLICT (org_key, sha256) DO NOTHING RETURNING removing_since`,
  );
  return rows.length > 0;
}

async function markedWithin(
  execute: StatementExecutor,
  owner: ContentOwner,
  sha256: string,
  { before, now, staleBefore }: RemovalTimes,
): Promise<HeadMarked> {
  const digest = theContent(owner, sha256);
  const marked = await execute.query(
    SQL`UPDATE ${heads} SET removing_since = ${now}
      WHERE ${digest} AND ((removing_since IS NULL AND kept_at < ${before}) OR removing_since < ${staleBefore})
      RETURNING removing_since`,
  );
  if (marked.rows.length > 0 || (await markedAlone(execute, owner, sha256, now))) {
    return { marked: true, since: now };
  }
  const standing = await execute.query(
    SQL`SELECT CAST(removing_since AS DOUBLE PRECISION) AS removing_since FROM ${heads} WHERE ${digest}`,
  );
  const marks = Schema.decodeUnknownSync(RemovingRows)(standing.rows).map(({ removing_since }) => removing_since);
  return { marked: false, answer: marks.includes(null) ? 'fresh' : 'removed' };
}

async function unmarkedBy(execute: StatementExecutor, digest: SQL, since: number): Promise<void> {
  await execute.command(
    SQL`DELETE FROM ${heads} WHERE ${digest} AND removing_since = ${since} AND upload_id = ${markedAloneBy}`,
  );
  await execute.command(SQL`UPDATE ${heads} SET removing_since = NULL WHERE ${digest} AND removing_since = ${since}`);
}

function readBy(execute: StatementExecutor, digest: SQL): Effect.Effect<KeptContentHead | undefined> {
  return Effect.promise(async () => {
    const { rows } = await execute.query(
      SQL`SELECT ${keptHeadColumns} FROM ${heads} WHERE ${digest} AND upload_id <> ${markedAloneBy}`,
    );
    return keptHeadIn(rows);
  });
}

function unmarkedOrStale({ staleBefore }: ErasureTimes): SQL {
  return SQL`(removing_since IS NULL OR removing_since < ${staleBefore})`;
}

export function expiredRead(times: ErasureTimes, most: number): SQL {
  return SQL`SELECT org_key, sha256 FROM ${heads}
    WHERE ${dueBy(times.now)} AND ${unmarkedOrStale(times)}
    ORDER BY expires_at LIMIT ${most}`;
}

function contentOf({ org_key, sha256 }: (typeof ExpiredRows.Type)[number]): ExpiredContent {
  const { org } = Option.getOrThrowWith(
    orgOfStreamPrefix(org_key),
    () => new Error(`A content head of ${org_key}, which is not the key of an org, expires`),
  );
  return { owner: { org }, sha256 };
}

function expiredBy(execute: StatementExecutor, times: ErasureTimes, most: number) {
  return Effect.promise(async () =>
    Schema.decodeUnknownSync(ExpiredRows)((await execute.query(expiredRead(times, most))).rows).map((row) =>
      contentOf(row),
    ),
  );
}

function erasingBy(execute: StatementExecutor, digest: SQL, times: ErasureTimes): Effect.Effect<number | undefined> {
  return Effect.promise(async () => {
    const { rows } = await execute.query(
      SQL`UPDATE ${heads} SET removing_since = ${times.now}
        WHERE ${digest} AND ${dueBy(times.now)} AND ${unmarkedOrStale(times)}
        RETURNING CAST(removing_since AS DOUBLE PRECISION) AS removing_since`,
    );
    return Schema.decodeUnknownSync(MarkedRows)(rows).at(0)?.removing_since;
  });
}

function erasedBy(execute: StatementExecutor, owner: ContentOwner, sha256: string, since: number) {
  const digest = theContent(owner, sha256);
  const uploadsOf = async (sql: SQL) => Schema.decodeUnknownSync(UploadRows)((await execute.query(sql)).rows);
  return Effect.promise(async () => {
    const named = await uploadsOf(
      SQL`SELECT place_key, upload_id FROM ${heads} WHERE ${digest} AND removing_since = ${since}`,
    );
    const recorded = await uploadsOf(
      SQL`UPDATE ${heads} SET erased_at = ${since}, expires_at = NULL, removing_since = NULL, upload_id = ${randomUUIDv7()}
        WHERE ${digest} AND removing_since = ${since} RETURNING place_key, upload_id`,
    );
    await inTurn(recorded.length > 0 ? named : [], ({ place_key, upload_id }) =>
      execute.command(SQL`DELETE FROM ${chunks} WHERE place_key = ${place_key} AND upload_id = ${upload_id}`),
    );
    await inTurn(recorded.length > 0 ? [digest] : [], (erased) =>
      execute.command(SQL`DELETE FROM ${places} WHERE ${erased}`),
    );
    return recorded.length > 0;
  });
}

async function clearedBy(execute: StatementExecutor, content: SQL, since: number): Promise<void> {
  const { rows } = await execute.query(
    SQL`DELETE FROM ${heads} WHERE ${content} AND removing_since = ${since} RETURNING removing_since`,
  );
  await inTurn(rows.length > 0 ? [content] : [], (cleared) =>
    execute.command(SQL`DELETE FROM ${places} WHERE ${cleared}`),
  );
}

export function externalHeadsOn(execute: ReturningExecutor, unlessHeld: UnlessHeld): ContentHeads {
  return {
    kept: (owner, sha256, head, keptAt) => keptBy(execute, { owner, sha256, head, keptAt }),
    touched: (owner, sha256, keptAt, expiresAt) => touchedBy(execute, theContent(owner, sha256), { keptAt, expiresAt }),
    marked: (owner, sha256, times) =>
      Effect.promise(async () => {
        const marked = await unlessHeld(owner, sha256, (within) => markedWithin(within, owner, sha256, times));
        return marked === 'held' ? { marked: false, answer: 'held' } : marked;
      }),
    cleared: (owner, sha256, since) => Effect.promise(() => clearedBy(execute, theContent(owner, sha256), since)),
    unmarked: (owner, sha256, since) => Effect.promise(() => unmarkedBy(execute, theContent(owner, sha256), since)),
    read: (owner, sha256) => readBy(execute, theContent(owner, sha256)),
    expired: (times, most) => expiredBy(execute, times, most),
    erasing: (owner, sha256, times) => erasingBy(execute, theContent(owner, sha256), times),
    erased: (owner, sha256, since) => erasedBy(execute, owner, sha256, since),
    placeOfNewBytes: placeOfNewBytesOf,
    placesOf: (owner, sha256) => placesRead(execute, keptShelf, owner, sha256),
    placed: (owner, sha256, place) => placeRecorded(execute, keptShelf, { owner, sha256, place }),
  };
}
