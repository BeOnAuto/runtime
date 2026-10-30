import { Option, Schema } from 'effect';

export type CursorPart = string | number;

export interface InsideARecord {
  readonly record: string;
  readonly index: number;
}

const CursorPartsSchema = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Int])))),
);

const decodeParts = Schema.decodeUnknownOption(CursorPartsSchema);

const encodeParts = Schema.encodeSync(CursorPartsSchema);

export function cursorOfParts(parts: readonly CursorPart[]): string {
  return encodeParts(parts);
}

export function partsOfCursor(cursor: string): Option.Option<readonly CursorPart[]> {
  return decodeParts(cursor);
}

export function cursorWithin(cursor: string, index: number): string {
  return Option.match(partsOfCursor(cursor), {
    onNone: () => cursor,
    onSome: (parts) => cursorOfParts([...parts, index]),
  });
}

function noParts(): readonly CursorPart[] {
  return [];
}

export function insideOf(cursor?: string): InsideARecord | undefined {
  const parts = cursor === undefined ? [] : Option.getOrElse(partsOfCursor(cursor), noParts);
  const index = parts.at(-1);
  return typeof index === 'number' ? { record: cursorOfParts(parts.slice(0, -1)), index } : undefined;
}
