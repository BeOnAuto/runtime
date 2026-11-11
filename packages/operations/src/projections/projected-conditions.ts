import {
  childKeyColumn,
  keepsChildRows,
  rowKeyColumn,
  type KeptProjection,
  type ProjectedColumnKind,
  type ProjectedKeyedRow,
  type ProjectedValue,
} from './keyed-projection.ts';

export type ProjectedCondition =
  | { readonly column: string; readonly equals: string | number | boolean }
  | { readonly column: string; readonly after: string | number }
  | { readonly column: string; readonly before: string | number };

export type ProjectedComparison = 'equals' | 'after' | 'before';

export interface ComparedColumn {
  readonly column: string;
  readonly comparison: ProjectedComparison;
  readonly value: string | number | boolean;
}

function comparisonOf(condition: ProjectedCondition): ComparedColumn {
  const { column } = condition;
  if ('equals' in condition) {
    return { column, comparison: 'equals', value: condition.equals };
  }
  return 'after' in condition
    ? { column, comparison: 'after', value: condition.after }
    : { column, comparison: 'before', value: condition.before };
}

function isKeyColumn(projection: KeptProjection, name: string): boolean {
  return name === rowKeyColumn || (name === childKeyColumn && keepsChildRows(projection));
}

function kindOfColumn(projection: KeptProjection, name: string): ProjectedColumnKind {
  if (isKeyColumn(projection, name)) {
    return 'text';
  }
  const declared = projection.columns.find((column) => column.name === name);
  if (declared === undefined) {
    throw new Error(`The projection ${projection.name} has no column ${name}`);
  }
  return declared.kind;
}

const comparableTypes: Readonly<Record<ProjectedColumnKind, readonly string[]>> = {
  text: ['string'],
  integer: ['number'],
  boolean: [],
};

export function comparedColumnOf(projection: KeptProjection, condition: ProjectedCondition): ComparedColumn {
  const compared = comparisonOf(condition);
  const kind = kindOfColumn(projection, compared.column);
  if (compared.comparison !== 'equals' && !comparableTypes[kind].includes(typeof compared.value)) {
    throw new Error(
      `The projection ${projection.name} cannot compare its ${kind} column ${compared.column} with ${JSON.stringify(compared.value)}`,
    );
  }
  return compared;
}

function holds(stored: ProjectedValue | undefined, { comparison, value }: ComparedColumn): boolean {
  if (comparison === 'equals') {
    return stored === value;
  }
  if (stored === null || stored === undefined) {
    return false;
  }
  return comparison === 'after' ? stored > value : stored < value;
}

function valueIn({ row, key, child }: ProjectedKeyedRow, column: string): ProjectedValue | undefined {
  if (column === rowKeyColumn) {
    return key;
  }
  return column === childKeyColumn ? child : row[column];
}

export function conditionsMetBy(
  projection: KeptProjection,
  where: readonly ProjectedCondition[],
): (kept: ProjectedKeyedRow) => boolean {
  const conditions = where.map((condition) => comparedColumnOf(projection, condition));
  return (kept) => conditions.every((condition) => holds(valueIn(kept, condition.column), condition));
}
