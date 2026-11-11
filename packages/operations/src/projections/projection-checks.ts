import {
  advancedColumnsOf,
  childKeyColumn,
  keepsChildRows,
  rowKeyColumn,
  scopesOf,
  type AdvancedColumn,
  type KeptProjection,
  type ProjectedIndex,
  type ProjectionDeclaration,
} from './keyed-projection.ts';

const projectionName = /^[a-z][a-z0-9_]{0,39}$/u;

const columnName = /^[a-z][a-z0-9_]{0,62}$/u;

const streamKind = /^[a-z][a-z0-9-]{0,39}$/u;

const keyColumns: ReadonlySet<string> = new Set(['playbook_key', rowKeyColumn, childKeyColumn]);

function requireNamed(what: string, name: string, pattern: Readonly<RegExp>): void {
  if (!pattern.test(name)) {
    throw new Error(`The ${what} name ${name} is malformed`);
  }
}

function requireKnownColumns(projection: ProjectionDeclaration, columns: readonly string[]): void {
  const known = new Set(projection.columns.map(({ name }) => name));
  const unknown = columns.find((column) => !known.has(column));
  if (unknown !== undefined) {
    throw new Error(`The projection ${projection.name} has no column ${unknown}`);
  }
}

function requireIndexedColumns(projection: KeptProjection, { columns, whereSet }: ProjectedIndex): void {
  const keys = keepsChildRows(projection) ? [rowKeyColumn, childKeyColumn] : [rowKeyColumn];
  const ordered = columns.filter((column) => !keys.includes(column));
  requireKnownColumns(projection, [...ordered, ...(whereSet === undefined ? [] : [whereSet])]);
}

function requireAdvancedSetByItsTypes(projection: ProjectionDeclaration, { column, setBy }: AdvancedColumn): void {
  const unknown = setBy.find((type) => !projection.types.includes(type));
  if (unknown !== undefined) {
    throw new Error(
      `The projection ${projection.name} does not fold ${unknown}, which it says sets its advanced column ${column}`,
    );
  }
}

function requireAdvancedOnce(projection: ProjectionDeclaration, columns: readonly string[]): void {
  const repeated = columns.find((column, at) => columns.indexOf(column) < at);
  if (repeated !== undefined) {
    throw new Error(`The projection ${projection.name} declares its advanced column ${repeated} more than once`);
  }
}

function requireStreamsFolded(projection: ProjectionDeclaration): void {
  if (scopesOf(projection).length === 0) {
    throw new Error(`The projection ${projection.name} names neither a playbook's streams nor an org's to fold`);
  }
  if (projection.kinds.length === 0) {
    throw new Error(`The projection ${projection.name} names no stream kind it folds`);
  }
  for (const kind of projection.kinds) {
    requireNamed('stream kind', kind, streamKind);
  }
}

function requireOneRowAdvanced(projection: KeptProjection, advanced: readonly string[]): void {
  if (keepsChildRows(projection) && advanced.length > 0) {
    throw new Error(
      `The projection ${projection.name} keeps several rows under a key, so its reader may advance none of its columns`,
    );
  }
}

export function requireProjectionNamed(name: string): void {
  requireNamed('projection', name, projectionName);
}

export function requireStreamKindNamed(kind: string): void {
  requireNamed('stream kind', kind, streamKind);
}

export function checkedProjection<Projection extends KeptProjection>(projection: Projection): Projection {
  requireNamed('projection', projection.name, projectionName);
  if (!Number.isSafeInteger(projection.version) || projection.version < 1) {
    throw new Error(`The projection ${projection.name} has a version that is not a whole number from 1`);
  }
  requireStreamsFolded(projection);
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
  requireOneRowAdvanced(projection, advanced);
  requireKnownColumns(projection, advanced);
  requireAdvancedOnce(projection, advanced);
  for (const column of projection.advanced ?? []) {
    requireAdvancedSetByItsTypes(projection, column);
  }
  return projection;
}
