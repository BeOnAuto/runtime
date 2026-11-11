import {
  scopesOf,
  type KeptProjection,
  type ProjectedMessage,
  type ProjectedStream,
} from '../projections/keyed-projection.ts';
import { checkedProjection, requireProjectionNamed, requireStreamKindNamed } from '../projections/projection-checks.ts';

export interface CountedRows {
  readonly projection: string;
  readonly facts: readonly string[];
}

interface MatchedColumn {
  readonly column: string;
  readonly equals: string;
}

export interface GroupwiseMaximum {
  readonly projection: string;
  readonly groups: string;
  readonly groupedBy: readonly string[];
  readonly greatest: string;
  readonly matching: readonly MatchedColumn[];
}

export type CheckpointsTable = Pick<StreamProjection, 'name' | 'version'>;

export interface StreamProjection {
  readonly name: string;
  readonly version: number;
  readonly kind: string;
  readonly streams: readonly string[];
  readonly tables: readonly KeptProjection[];
  readonly counted: readonly CountedRows[];
  readonly groupwiseMaxima: readonly GroupwiseMaximum[];
}

const streamId = /^[A-Za-z0-9_-]{1,64}$/u;

export function checkpointsOf({ name, version }: Pick<StreamProjection, 'name' | 'version'>): CheckpointsTable {
  return { name: `${name}_checkpoints`, version };
}

export function typesOf({ tables }: Pick<StreamProjection, 'tables'>): readonly string[] {
  return [...new Set(tables.flatMap(({ types }) => types))];
}

function requireItsTables(projection: StreamProjection): void {
  for (const table of projection.tables) {
    checkedProjection(table);
    if (table.version !== projection.version) {
      throw new Error(
        `The table ${table.name} of the stream projection ${projection.name} takes version ${table.version}, not the projection's ${projection.version}`,
      );
    }
    if (table.kinds.join('/') !== projection.kind || scopesOf(table).join('/') !== 'playbook') {
      throw new Error(
        `The table ${table.name} of the stream projection ${projection.name} folds other streams than a playbook's ${projection.kind}`,
      );
    }
  }
}

function requireItsCounts(projection: StreamProjection): void {
  for (const { projection: counted, facts } of projection.counted) {
    const table = projection.tables.find(({ name }) => name === counted);
    const unfolded = facts.find((type) => table?.types.includes(type) !== true);
    if (unfolded !== undefined) {
      throw new Error(
        `The stream projection ${projection.name} counts the facts ${unfolded} against ${counted}, which none of its tables of that name folds`,
      );
    }
  }
}

function columnsOf(projection: StreamProjection, table: string): ReadonlySet<string> | undefined {
  const named = projection.tables.find(({ name }) => name === table);
  return named === undefined ? undefined : new Set(named.columns.map(({ name }) => name));
}

interface NamedColumn {
  readonly columns: ReadonlySet<string> | undefined;
  readonly column: string;
}

function unknownColumn(
  projection: StreamProjection,
  { projection: checked, groups, groupedBy, greatest, matching }: GroupwiseMaximum,
): string | undefined {
  const [ofTheRows, ofTheGroups] = [columnsOf(projection, checked), columnsOf(projection, groups)];
  const named: readonly NamedColumn[] = [
    ...groupedBy.flatMap((column): readonly NamedColumn[] => [
      { columns: ofTheRows, column },
      { columns: ofTheGroups, column },
    ]),
    { columns: ofTheGroups, column: greatest },
    ...matching.flatMap(({ column, equals }): readonly NamedColumn[] => [
      { columns: ofTheRows, column },
      { columns: ofTheGroups, column: equals },
    ]),
  ];
  return named.find(({ columns, column }) => columns?.has(column) !== true)?.column;
}

function requireItsMaxima(projection: StreamProjection): void {
  for (const maximum of projection.groupwiseMaxima) {
    const unknown = maximum.matching.length === 0 ? 'nothing it matches' : unknownColumn(projection, maximum);
    if (unknown !== undefined) {
      throw new Error(
        `The stream projection ${projection.name} matches ${maximum.projection} to the greatest of its group in ${maximum.groups} by ${unknown}, which is no column of theirs`,
      );
    }
  }
}

export function checkedStreamProjection(projection: StreamProjection): StreamProjection {
  requireProjectionNamed(checkpointsOf(projection).name);
  requireStreamKindNamed(projection.kind);
  const malformed = projection.streams.find((id) => !streamId.test(id));
  if (malformed !== undefined) {
    throw new Error(`The stream projection ${projection.name} names the stream ${malformed}, which is malformed`);
  }
  requireItsTables(projection);
  requireItsCounts(projection);
  requireItsMaxima(projection);
  return projection;
}

function ofItsStreams(projection: StreamProjection, table: KeptProjection): KeptProjection {
  const keyOf = (message: ProjectedMessage, stream: ProjectedStream): string | undefined => {
    if (!projection.streams.includes(stream.id)) {
      return undefined;
    }
    return table.keyOf === undefined ? stream.id : table.keyOf(message, stream);
  };
  return { ...table, keyOf };
}

export function inlineTablesOf(projection: StreamProjection): readonly KeptProjection[] {
  return checkedStreamProjection(projection).tables.map((table) => ofItsStreams(projection, table));
}

export function isStreamProjection(kept: KeptProjection | StreamProjection): kept is StreamProjection {
  return 'tables' in kept;
}
