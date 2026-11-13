import { Result, Schema } from 'effect';

const decodeJson = Schema.decodeUnknownResult(Schema.Json);

export function jsonOf(value: unknown, what: string): Result.Result<Schema.Json, readonly string[]> {
  return Result.mapError(decodeJson(value), () => [`${what} is not plain JSON`]);
}
