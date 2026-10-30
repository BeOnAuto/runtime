import type { SQL } from '@event-driven-io/dumbo';
import type { ProjectedColumn, ProjectedColumnKind, ProjectedValue } from '@on.auto/operations';
import { Schema } from 'effect';

export interface ProjectionDialect {
  readonly tableVersions: (name: string) => SQL;
  readonly columnTypes: Readonly<Record<ProjectedColumnKind, string>>;
  readonly playbookIndexNulls: string;
  readonly asNumber: (expression: string) => string;
  readonly streamsAfter: (after: string, count: number, kinds: readonly string[], types: readonly string[]) => SQL;
  readonly messagesOf: (streams: readonly string[], types: readonly string[]) => SQL;
  readonly messagesInOrderAfter: (
    after: string | undefined,
    count: number,
    kinds: readonly string[],
    types: readonly string[],
  ) => SQL;
  readonly rowsInAWrite: (columns: number) => number;
  readonly filledData: (column: unknown) => unknown;
  readonly filledMetadata: (column: unknown) => unknown;
  readonly appendedData: (stored: unknown) => unknown;
  readonly booleanOf: (value: boolean) => boolean | number;
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
