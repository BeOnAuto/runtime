export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function hasKey(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.hasOwn(record, key);
}

export function entriesOf(record: Readonly<Record<string, unknown>>): readonly (readonly [string, unknown])[] {
  return Object.entries(record);
}

export function itemsOf(list: readonly unknown[]): readonly (readonly [number, unknown])[] {
  return [...list.entries()];
}
