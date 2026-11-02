import type { SQL } from '@event-driven-io/dumbo';
import {
  scopesOf,
  type KeyedProjection,
  type ProjectedColumn,
  type ProjectedColumnKind,
  type ProjectedValue,
  type StreamScope,
} from '@on.auto/operations';
import { Schema } from 'effect';

export interface FoldedStreams {
  readonly scopes: readonly StreamScope[];
  readonly kinds: readonly string[];
}

export interface MessageLane {
  readonly by: 'stream' | 'prefix';
  readonly key: string;
}

export type StreamsInOrder =
  | { readonly of: 'folded'; readonly folded: FoldedStreams }
  | { readonly of: 'lane'; readonly lane: MessageLane }
  | { readonly of: 'every' };

export interface ProjectionDialect {
  readonly tableVersions: (name: string) => SQL;
  readonly columnTypes: Readonly<Record<ProjectedColumnKind, string>>;
  readonly playbookIndexNulls: string;
  readonly asNumber: (expression: string) => string;
  readonly streamsAfter: (after: string, count: number, folded: FoldedStreams, types: readonly string[]) => SQL;
  readonly messagesOf: (streams: readonly string[], types: readonly string[]) => SQL;
  readonly messagesInOrderAfter: (
    after: string | undefined,
    count: number,
    streams: StreamsInOrder,
    types: readonly string[],
  ) => SQL;
  readonly messageAt: (stream: string, position: number) => SQL;
  readonly keyLocks: (table: string, prefix: string, key: string) => readonly SQL[];
  readonly rowLocks: (table: string, prefix: string, key: string) => readonly SQL[];
  readonly rowsInAWrite: (columns: number) => number;
  readonly filledData: (column: unknown) => unknown;
  readonly filledMetadata: (column: unknown) => unknown;
  readonly appendedData: (stored: unknown) => unknown;
  readonly storedData: (data: Schema.JsonObject) => Readonly<Record<string, unknown>>;
  readonly booleanOf: (value: boolean) => boolean | number;
}

export function foldedStreamsOf(projection: KeyedProjection): FoldedStreams {
  return { scopes: scopesOf(projection), kinds: projection.kinds };
}

export function selectedColumn({ asNumber }: ProjectionDialect, { name, kind }: ProjectedColumn): string {
  return kind === 'integer' ? `${asNumber(name)} AS ${name}` : name;
}

const decodeText = Schema.decodeUnknownSync(Schema.NullOr(Schema.String));

const decodeNumber = Schema.decodeUnknownSync(Schema.NullOr(Schema.Number));

const decodeBoolean = Schema.decodeUnknownSync(Schema.NullOr(Schema.Union([Schema.Boolean, Schema.Literals([0, 1])])));

const decoders: Readonly<Record<ProjectedColumnKind, (stored: unknown) => ProjectedValue>> = {
  text: decodeText,
  integer: decodeNumber,
  boolean: (stored) => {
    const value = decodeBoolean(stored);
    return typeof value === 'number' ? value === 1 : value;
  },
};

export function valueOf({ kind }: ProjectedColumn, stored: unknown): ProjectedValue {
  return decoders[kind](stored);
}

export function boundOf(dialect: ProjectionDialect, value: ProjectedValue): ProjectedValue {
  return typeof value === 'boolean' ? dialect.booleanOf(value) : value;
}
