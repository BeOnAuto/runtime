export const sqliteMostBoundValues = 32_766;

export const postgresqlMostBoundValues = 65_535;

export const mostValuesTheLedgerBindsOnSQLite = 100;

export interface ValuesBound {
  readonly mostBoundValues: number;
  readonly valuesEach: number;
  readonly valuesBeside?: number;
}

export function chunksOf<Item>(items: readonly Item[], size: number): readonly (readonly Item[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function requireCounted(name: string, value: number, least: number): void {
  if (!Number.isInteger(value) || value < least) {
    throw new Error(`The ${name} is a whole number of at least ${least}, not ${value}`);
  }
}

export function itemsInAStatement({ mostBoundValues, valuesEach, valuesBeside = 0 }: ValuesBound): number {
  requireCounted('most values a statement may bind', mostBoundValues, 1);
  requireCounted('count of values a statement binds for each item', valuesEach, 1);
  requireCounted('count of values a statement binds beside its items', valuesBeside, 0);
  const items = Math.floor((mostBoundValues - valuesBeside) / valuesEach);
  if (items < 1) {
    throw new Error(
      `A statement that binds ${valuesBeside} values beside ${valuesEach} for each item binds more than the ${mostBoundValues} its database allows`,
    );
  }
  return items;
}

export function chunksWithin<Item>(items: readonly Item[], bound: ValuesBound): readonly (readonly Item[])[] {
  return chunksOf(items, itemsInAStatement(bound));
}
