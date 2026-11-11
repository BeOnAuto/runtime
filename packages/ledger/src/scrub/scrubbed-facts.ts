import { SQL } from '@event-driven-io/dumbo';
import { contextOf } from '@on.auto/operations';
import { Schema } from 'effect';

import type { FactScrubStore, ScrubbedData } from '../event-store.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { filledMessageOf, type ProjectionKeeping } from '../projections/projection-keeping.ts';
import { rowsRefolded } from '../projections/projection-refold.ts';
import type { ContentReferences } from '../references/content-references.ts';
import type { StreamProjectionParts } from '../stream-projections/stream-projection-parts.ts';
import type { Rider } from './append-riders.ts';

const defaultPartition = 'emt:default';

const noPosition = 0;

const FactRows = Schema.Array(
  Schema.Struct({ version: Schema.Number, type: Schema.NullOr(Schema.String), metadata: Schema.Unknown }),
);

const decodeFactRows = Schema.decodeUnknownSync(FactRows);

const decodeTheFact = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.Struct({
      stream: Schema.String,
      type: Schema.String,
      data: Schema.Unknown,
      metadata: Schema.Unknown,
      position: Schema.Number,
    }),
  ]),
);

export type ReadQuery = (sql: SQL) => Promise<readonly unknown[]>;

function factAtStatement({ asNumber }: ProjectionDialect, stream: string, position: number): SQL {
  return SQL`SELECT ${SQL.plain(asNumber('s.stream_position'))} AS version, m.message_type AS type,
      m.message_metadata AS metadata
    FROM emt_streams AS s
    LEFT JOIN emt_messages AS m
      ON m.stream_id = s.stream_id AND m.stream_position = ${position}
        AND m.partition = s.partition AND m.is_archived = FALSE
    WHERE s.stream_id = ${stream} AND s.partition = ${defaultPartition} AND s.is_archived = FALSE`;
}

export function factAtOn(dialect: ProjectionDialect, query: ReadQuery): FactScrubStore['factAt'] {
  return async (stream, position) => {
    const lookedUp = Number.isSafeInteger(position) ? position : noPosition;
    const [found] = decodeFactRows(await query(factAtStatement(dialect, stream, lookedUp)));
    if (found === undefined) {
      return { found: 'no_stream' };
    }
    if (found.type === null) {
      return { found: 'no_fact', version: found.version };
    }
    const context = contextOf(dialect.filledMetadata(found.metadata));
    return { found: 'fact', version: found.version, type: found.type, context };
  };
}

interface ScrubParts {
  readonly dialect: ProjectionDialect;
  readonly keepings: readonly ProjectionKeeping[];
  readonly references: Pick<ContentReferences, 'refolded'>;
  readonly streams: Pick<StreamProjectionParts, 'scrubbed'>;
}

export function scrubWithin(
  { dialect, keepings, references, streams }: ScrubParts,
  stream: string,
  scrubbed: ScrubbedData,
): Rider {
  const { position, data, payloadBytes } = scrubbed;
  return async (execute) => {
    const [fact] = decodeTheFact((await execute.query(dialect.messageAt(stream, position))).rows);
    await execute.command(
      SQL`UPDATE emt_messages SET message_data = ${dialect.storedData(data)},
          message_metadata = ${dialect.metadataMeasured(payloadBytes)}
        WHERE stream_id = ${stream} AND stream_position = ${position}
          AND partition = ${defaultPartition} AND is_archived = FALSE`,
    );
    const before = filledMessageOf({ dialect }, fact);
    await rowsRefolded(keepings, execute, { stream, before, after: { ...before, data } });
    await references.refolded(execute, stream);
    await streams.scrubbed(execute, stream);
  };
}
