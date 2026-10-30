import { Option, type Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { playbookOfStreamPrefix } from '../ledger/bound-ports.ts';
import type { Context } from '../ledger/context.ts';

export type ProjectedValue = string | number | boolean | null;

export type ProjectedRow = Readonly<Record<string, ProjectedValue>>;

export type ProjectedColumnKind = 'text' | 'integer' | 'boolean';

export interface ProjectedColumn {
  readonly name: string;
  readonly kind: ProjectedColumnKind;
}

export interface ProjectedIndex {
  readonly name: string;
  readonly columns: readonly string[];
  readonly acrossPlaybooks?: boolean;
  readonly whereSet?: string;
}

export interface ProjectedMessage {
  readonly id: string;
  readonly position: number;
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
}

export interface ProjectedStream {
  readonly kind: string;
  readonly id: string;
}

export interface AdvancedColumn {
  readonly column: string;
  readonly setBy: readonly string[];
}

export interface KeyedProjection {
  readonly name: string;
  readonly version: number;
  readonly kinds: readonly string[];
  readonly types: readonly string[];
  readonly columns: readonly ProjectedColumn[];
  readonly indexes: readonly ProjectedIndex[];
  readonly keyOf?: (message: ProjectedMessage, stream: ProjectedStream) => string | undefined;
  readonly advanced?: readonly AdvancedColumn[];
  readonly rowAfter: (row: ProjectedRow | undefined, message: ProjectedMessage) => ProjectedRow | undefined;
}

export interface ProjectedCondition {
  readonly column: string;
  readonly equals: string | number | boolean;
}

export type ProjectedOrder = 'asc' | 'desc';

export interface ProjectedRowsQuery {
  readonly where: readonly ProjectedCondition[];
  readonly orderBy: readonly string[];
  readonly order: ProjectedOrder;
  readonly after?: readonly ProjectedValue[];
  readonly limit: number;
}

export interface ProjectedKeyedRow {
  readonly org: string;
  readonly playbook: string;
  readonly key: string;
  readonly row: ProjectedRow;
}

export interface DueRowsQuery {
  readonly column: string;
  readonly through: number;
  readonly limit: number;
}

export interface ProjectionReader {
  readonly readProjectedRows: (
    projection: string,
    playbook: PlaybookAddress,
    query: ProjectedRowsQuery,
  ) => Effect.Effect<readonly ProjectedKeyedRow[]>;
  readonly countProjectedRows: (
    projection: string,
    playbook: PlaybookAddress,
    where: readonly ProjectedCondition[],
  ) => Effect.Effect<number>;
  readonly readDueRows: (projection: string, query: DueRowsQuery) => Effect.Effect<readonly ProjectedKeyedRow[]>;
  readonly nextDueOf: (projection: string, column: string, after: number) => Effect.Effect<number | null>;
}

export interface RowAdvance {
  readonly set: ProjectedRow;
  readonly when: readonly ProjectedCondition[];
}

export interface ProjectionAdvancer {
  readonly advanceRow: (
    projection: string,
    playbook: PlaybookAddress,
    key: string,
    advance: RowAdvance,
  ) => Effect.Effect<void>;
}

export interface PlaybookProjectionReader {
  readonly readProjectedRows: (
    projection: string,
    query: ProjectedRowsQuery,
  ) => Effect.Effect<readonly ProjectedKeyedRow[]>;
  readonly countProjectedRows: (projection: string, where: readonly ProjectedCondition[]) => Effect.Effect<number>;
}

export const rowKeyColumn = 'row_key';

const projectionName = /^[a-z][a-z0-9_]{0,39}$/u;

const columnName = /^[a-z][a-z0-9_]{0,62}$/u;

const streamKind = /^[a-z][a-z0-9-]{0,39}$/u;

const keyColumns: ReadonlySet<string> = new Set(['playbook_key', rowKeyColumn]);

const aKeyKindAndId = /^([^/]+\/[^/]+\/[^/]+\/)([^/]+)\/([^/]+)$/u;

export interface PlaybookStream extends ProjectedStream {
  readonly playbookKey: string;
  readonly playbook: PlaybookAddress;
}

export function playbookStreamOf(stream: string): PlaybookStream | undefined {
  const [, playbookKey = '', kind = '', id = ''] = aKeyKindAndId.exec(stream) ?? [];
  return Option.getOrUndefined(
    Option.map(playbookOfStreamPrefix(playbookKey), (playbook) => ({ playbookKey, playbook, kind, id })),
  );
}

export function rowKeyOf(
  projection: KeyedProjection,
  message: ProjectedMessage,
  stream: PlaybookStream,
): string | undefined {
  if (!projection.kinds.includes(stream.kind)) {
    return undefined;
  }
  return projection.keyOf === undefined ? stream.id : projection.keyOf(message, stream);
}

export function advancedColumnsOf({ advanced = [] }: KeyedProjection): readonly string[] {
  return advanced.map(({ column }) => column);
}

export function advancedColumnsLeftBy({ advanced = [] }: KeyedProjection, type: string): readonly string[] {
  return advanced.filter(({ setBy }) => !setBy.includes(type)).map(({ column }) => column);
}

function requireNamed(what: string, name: string, pattern: Readonly<RegExp>): void {
  if (!pattern.test(name)) {
    throw new Error(`The ${what} name ${name} is malformed`);
  }
}

function requireKnownColumns(projection: KeyedProjection, columns: readonly string[]): void {
  const known = new Set(projection.columns.map(({ name }) => name));
  const unknown = columns.find((column) => !known.has(column));
  if (unknown !== undefined) {
    throw new Error(`The projection ${projection.name} has no column ${unknown}`);
  }
}

function requireIndexedColumns(projection: KeyedProjection, { columns, whereSet }: ProjectedIndex): void {
  const ordered = columns.filter((column) => column !== rowKeyColumn);
  requireKnownColumns(projection, [...ordered, ...(whereSet === undefined ? [] : [whereSet])]);
}

function requireAdvancedSetByItsTypes(projection: KeyedProjection, { column, setBy }: AdvancedColumn): void {
  const unknown = setBy.find((type) => !projection.types.includes(type));
  if (unknown !== undefined) {
    throw new Error(
      `The projection ${projection.name} does not fold ${unknown}, which it says sets its advanced column ${column}`,
    );
  }
}

function requireAdvancedOnce(projection: KeyedProjection, columns: readonly string[]): void {
  const repeated = columns.find((column, at) => columns.indexOf(column) < at);
  if (repeated !== undefined) {
    throw new Error(`The projection ${projection.name} declares its advanced column ${repeated} more than once`);
  }
}

export function checkedProjection(projection: KeyedProjection): KeyedProjection {
  requireNamed('projection', projection.name, projectionName);
  if (!Number.isSafeInteger(projection.version) || projection.version < 1) {
    throw new Error(`The projection ${projection.name} has a version that is not a whole number from 1`);
  }
  if (projection.kinds.length === 0) {
    throw new Error(`The projection ${projection.name} names no stream kind it folds`);
  }
  for (const kind of projection.kinds) {
    requireNamed('stream kind', kind, streamKind);
  }
  for (const { name } of projection.columns) {
    requireNamed('column', name, columnName);
    if (keyColumns.has(name)) {
      throw new Error(`The projection ${projection.name} may not name a column ${name}, which keys every row`);
    }
  }
  for (const index of projection.indexes) {
    requireNamed('index', index.name, columnName);
    requireIndexedColumns(projection, index);
  }
  const advanced = advancedColumnsOf(projection);
  requireKnownColumns(projection, advanced);
  requireAdvancedOnce(projection, advanced);
  for (const column of projection.advanced ?? []) {
    requireAdvancedSetByItsTypes(projection, column);
  }
  return projection;
}

export function requireAdvancedColumns(projection: KeyedProjection, columns: ProjectedRow): void {
  const advanced = new Set(advancedColumnsOf(projection));
  const other = Object.keys(columns).find((column) => !advanced.has(column));
  if (other !== undefined) {
    throw new Error(`The projection ${projection.name} does not let its reader advance the column ${other}`);
  }
}

export function projectedTableOf({ name, version }: Pick<KeyedProjection, 'name' | 'version'>): string {
  return `${name}_${version}`;
}
