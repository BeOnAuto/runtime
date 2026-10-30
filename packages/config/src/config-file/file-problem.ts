import { JsonPointer, type Schema } from 'effect';

export interface FileProblem {
  readonly pointer: string;
  readonly detail: string;
}

export type JsonEntry = readonly [string, Schema.Json];

export function entriesOf(value: Schema.Json): readonly JsonEntry[] {
  if (Array.isArray(value)) {
    return value.map((item, index): JsonEntry => [String(index), item]);
  }
  return typeof value === 'object' && value !== null ? Object.entries(value) : [];
}

export function below(pointer: string, key: string): string {
  return `${pointer}/${JsonPointer.escapeToken(key)}`;
}
