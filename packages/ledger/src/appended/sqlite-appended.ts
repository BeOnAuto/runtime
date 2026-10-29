import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type {
  AppendListeners,
  AppendWaitsStore,
  LatestAppends,
  ReadLatestAppends,
  RecordedStore,
  StreamAgesStore,
} from '../event-store.ts';
import { kindKeyOfStream } from '../recorded/sqlite-indexes.ts';
import { sqliteStreamAges } from '../stream-ages/sqlite-stream-ages.ts';
import { appendWatchOf } from './append-watch.ts';

const defaultPartition = 'emt:default';

const NewestRow = Schema.Tuple([Schema.Struct({ position: Schema.Int })]);

const AppendedRows = Schema.Array(Schema.Struct({ name: Schema.String, read: Schema.Int, position: Schema.Int }));

const slashesOfAKind = 4;

async function newestPoint(execute: SQLExecutor): Promise<LatestAppends> {
  const { rows } = await execute.query(SQL`SELECT coalesce(max(global_position), 0) AS position FROM emt_messages`);
  const [newest] = Schema.decodeUnknownSync(NewestRow)(rows);
  return { streams: [], latest: new Map(), through: [String(newest.position)], more: false };
}

export function sqliteAppended(
  execute: SQLExecutor,
  listeners: AppendListeners = {},
): Pick<RecordedStore, 'readAppended'> & StreamAgesStore & AppendWaitsStore {
  const readAppended = appendedAfter(execute);
  return { readAppended, ...appendWatchOf(readAppended, listeners), ...sqliteStreamAges(execute) };
}

function appendedAfter(execute: SQLExecutor): ReadLatestAppends {
  return async (after, most) => {
    if (after === undefined) {
      return newestPoint(execute);
    }
    const { rows } = await execute.query(
      SQL`SELECT name, count(*) AS read, max(global_position) AS position
        FROM (
          SELECT global_position,
            CASE WHEN length(stream_id) - length(replace(stream_id, '/', '')) >= ${slashesOfAKind}
              THEN ${kindKeyOfStream} ELSE stream_id END AS name
          FROM emt_messages
          WHERE global_position > ${Number(after[0])} AND partition = ${defaultPartition} AND is_archived = FALSE
          ORDER BY global_position
          LIMIT ${most}
        )
        GROUP BY name`,
    );
    const groups = Schema.decodeUnknownSync(AppendedRows)(rows);
    const through = groups.reduce((latest, { position }) => Math.max(latest, position), Number(after[0]));
    const read = groups.reduce((sum, group) => sum + group.read, 0);
    return {
      streams: groups.map(({ name }) => name),
      latest: new Map(groups.map(({ name, position }) => [name, [String(position)]])),
      through: [String(through)],
      more: read >= most,
    };
  };
}
