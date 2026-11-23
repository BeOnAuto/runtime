import type { ServerEntryFields } from '@on.auto/tool-servers';
import type { Schema } from 'effect';

export function literalText(text: string): string {
  return text.replaceAll('$', () => '$$');
}

export function literalValues(values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]: readonly [string, string]) => [name, literalText(value)]),
  );
}

export function pathValuesWritten(
  pathValues: Readonly<Record<string, string>> | undefined,
): Pick<ServerEntryFields, 'path_values'> {
  return pathValues === undefined ? {} : { path_values: literalValues(pathValues) };
}

export function literal(value: Schema.Json): Schema.Json {
  if (typeof value === 'string') {
    return literalText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item: Schema.Json) => literal(item));
  }
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]: readonly [string, Schema.Json]) => [key, literal(item)]),
      )
    : value;
}
