import { SQL } from '@event-driven-io/dumbo';
import type { ContentHead, ContentHeads, ContentOwner, HeadKept, HeadMarked, RemovalTimes } from '@on.auto/content';
import { randomUUIDv7, streamPrefixOfPlaybook } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { StatementExecutor, UnlessHeld } from '../event-store.ts';
import { keptShelf } from './content-tables.ts';

interface HeadKeeping {
  readonly playbook: ContentOwner;
  readonly sha256: string;
  readonly head: ContentHead;
  readonly keptAt: number;
}

const heads = SQL.identifier(keptShelf.heads);

const keptExternally = 'external';

const markedAloneBy = '';

const HeadRow = Schema.Struct({
  upload_id: Schema.String,
  bytes: Schema.Number,
  media_type: Schema.String,
  removing_since: Schema.NullOr(Schema.Number),
});

const OneHead = Schema.Tuple([HeadRow]);

const HeadRows = Schema.Array(HeadRow);

const StandingRows = Schema.Array(Schema.Struct({ bytes: Schema.Number, media_type: Schema.String }));

const RemovingRows = Schema.Array(Schema.Struct({ removing_since: Schema.NullOr(Schema.Number) }));

const headColumns = SQL.plain(
  'upload_id, CAST(bytes AS DOUBLE PRECISION) AS bytes, media_type, CAST(removing_since AS DOUBLE PRECISION) AS removing_since',
);

function theDigest(playbook: ContentOwner, sha256: string): SQL {
  return SQL`playbook_key = ${streamPrefixOfPlaybook(playbook)} AND sha256 = ${sha256}`;
}

function keptAs(row: typeof HeadRow.Type, putBy: string): HeadKept {
  if (row.removing_since !== null) {
    return { kept: 'removing', since: row.removing_since };
  }
  return { kept: row.upload_id === putBy ? 'new' : 'standing', head: { bytes: row.bytes, mediaType: row.media_type } };
}

function keptBy(execute: StatementExecutor, { playbook, sha256, head, keptAt }: HeadKeeping): Effect.Effect<HeadKept> {
  const putBy = randomUUIDv7();
  return Effect.promise(async () => {
    const { rows } = await execute.query(
      SQL`INSERT INTO ${heads} (playbook_key, sha256, upload_id, bytes, chunks, media_type, kept_at, kept_in)
        VALUES (${streamPrefixOfPlaybook(playbook)}, ${sha256}, ${putBy}, ${head.bytes}, 0, ${head.mediaType}, ${keptAt}, ${keptExternally})
        ON CONFLICT (playbook_key, sha256) DO UPDATE SET kept_at =
          CASE WHEN ${heads}.removing_since IS NULL THEN excluded.kept_at ELSE ${heads}.kept_at END
        RETURNING ${headColumns}`,
    );
    const [row] = Schema.decodeUnknownSync(OneHead)(rows);
    return keptAs(row, putBy);
  });
}

function touchedBy(
  execute: StatementExecutor,
  playbook: ContentOwner,
  sha256: string,
  keptAt: number,
): Effect.Effect<HeadKept | undefined> {
  return Effect.promise(async () => {
    const { rows } = await execute.query(
      SQL`UPDATE ${heads} SET kept_at = CASE WHEN removing_since IS NULL THEN ${keptAt} ELSE kept_at END
        WHERE ${theDigest(playbook, sha256)} RETURNING ${headColumns}`,
    );
    const row = Schema.decodeUnknownSync(HeadRows)(rows).at(0);
    return row === undefined ? undefined : keptAs(row, '');
  });
}

async function markedAlone(
  execute: StatementExecutor,
  playbook: ContentOwner,
  sha256: string,
  now: number,
): Promise<boolean> {
  const { rows } = await execute.query(
    SQL`INSERT INTO ${heads} (playbook_key, sha256, upload_id, bytes, chunks, media_type, kept_at, kept_in, removing_since)
      VALUES (${streamPrefixOfPlaybook(playbook)}, ${sha256}, ${markedAloneBy}, 0, 0, '', 0, ${keptExternally}, ${now})
      ON CONFLICT (playbook_key, sha256) DO NOTHING RETURNING removing_since`,
  );
  return rows.length > 0;
}

async function markedWithin(
  execute: StatementExecutor,
  playbook: ContentOwner,
  sha256: string,
  { before, now, staleBefore }: RemovalTimes,
): Promise<HeadMarked> {
  const digest = theDigest(playbook, sha256);
  const marked = await execute.query(
    SQL`UPDATE ${heads} SET removing_since = ${now}
      WHERE ${digest} AND ((removing_since IS NULL AND kept_at < ${before}) OR removing_since < ${staleBefore})
      RETURNING removing_since`,
  );
  if (marked.rows.length > 0 || (await markedAlone(execute, playbook, sha256, now))) {
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

function readBy(execute: StatementExecutor, digest: SQL): Effect.Effect<ContentHead | undefined> {
  return Effect.promise(async () => {
    const { rows } = await execute.query(
      SQL`SELECT CAST(bytes AS DOUBLE PRECISION) AS bytes, media_type FROM ${heads}
        WHERE ${digest} AND upload_id <> ${markedAloneBy}`,
    );
    return Schema.decodeUnknownSync(StandingRows)(rows)
      .map(({ bytes, media_type }) => ({ bytes, mediaType: media_type }))
      .at(0);
  });
}

export function externalHeadsOn(execute: StatementExecutor, unlessHeld: UnlessHeld): ContentHeads {
  return {
    kept: (playbook, sha256, head, keptAt) => keptBy(execute, { playbook, sha256, head, keptAt }),
    touched: (playbook, sha256, keptAt) => touchedBy(execute, playbook, sha256, keptAt),
    marked: (playbook, sha256, times) =>
      Effect.promise(async () => {
        const marked = await unlessHeld(playbook, sha256, (within) => markedWithin(within, playbook, sha256, times));
        return marked === 'held' ? { marked: false, answer: 'held' } : marked;
      }),
    cleared: (playbook, sha256, since) =>
      Effect.asVoid(
        Effect.promise(() =>
          execute.command(SQL`DELETE FROM ${heads} WHERE ${theDigest(playbook, sha256)} AND removing_since = ${since}`),
        ),
      ),
    unmarked: (playbook, sha256, since) =>
      Effect.promise(() => unmarkedBy(execute, theDigest(playbook, sha256), since)),
    read: (playbook, sha256) => readBy(execute, theDigest(playbook, sha256)),
  };
}
