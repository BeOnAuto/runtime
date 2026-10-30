import { pointerOf, type SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

type Json = Schema.Json | undefined;

export type Path = readonly (string | number)[];

const nothing: Schema.JsonObject = {};

export const counted = new Intl.NumberFormat('en');

export function isList(value: Json): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

export function recordOf(value: Json): Schema.JsonObject {
  return typeof value === 'object' && value !== null && !isList(value) ? value : nothing;
}

export function itemsOf(value: Json): readonly Schema.Json[] {
  return isList(value) ? value : [];
}

export function textValue(value: Json): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOf(value: Json): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function issueAt(path: Path, detail: string): SchemaIssue {
  return { pointer: pointerOf(path), detail };
}

function lowHolds(low: number | undefined, value: number): boolean {
  return low === undefined || low <= value;
}

function highHolds(high: number | undefined, value: number): boolean {
  return high === undefined || high >= value;
}

interface PointRange {
  readonly low?: number;
  readonly value: number;
  readonly high?: number;
}

export function rangeHolds({ low, value, high }: PointRange): boolean {
  return lowHolds(low, value) && highHolds(high, value);
}

export function rangeIssues(entry: Json, path: Path): readonly SchemaIssue[] {
  const { value, low, high } = recordOf(entry);
  const middle = numberOf(value);
  if (middle === undefined) {
    return [];
  }
  return [
    ...(lowHolds(numberOf(low), middle) ? [] : [issueAt([...path, 'low'], 'Expected a low of at most the value')]),
    ...(highHolds(numberOf(high), middle) ? [] : [issueAt([...path, 'high'], 'Expected a high of at least the value')]),
  ];
}

export function repeatedNameIssues(entries: readonly Schema.Json[], path: Path, noun: string): readonly SchemaIssue[] {
  const seen = new Set<string>();
  return entries.flatMap((entry, index) => {
    const name = textValue(recordOf(entry)['name']);
    if (name === undefined) {
      return [];
    }
    const repeated = seen.has(name);
    seen.add(name);
    return repeated ? [issueAt([...path, index, 'name'], `Expected a name no ${noun} before it has`)] : [];
  });
}
