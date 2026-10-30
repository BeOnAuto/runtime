import { JsonPointer, Result, Schema, SchemaIssue, type StandardSchema } from 'effect';

type PathSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

export interface SettingProblem {
  readonly setting: string;
  readonly pointer?: string;
  readonly detail: string;
}

export type SettingDecoder<A> = (input: unknown) => Result.Result<A, Schema.SchemaError>;

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

export const strictly = { onExcessProperty: 'error', errors: 'all' } as const;

function isPropertyKey(segment: PathSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

export function pointerOf(path: readonly PropertyKey[]): string {
  return path.map((segment) => `/${JsonPointer.escapeToken(String(segment))}`).join('');
}

export function problem(setting: string, pointer: string, detail: string): SettingProblem {
  return { setting, pointer, detail };
}

export function settingProblemText({ setting, pointer, detail }: SettingProblem): string {
  return pointer === undefined ? `${setting}: ${detail}` : `${setting}: ${pointer === '' ? '/' : pointer}: ${detail}`;
}

function parsedJson(setting: string, text: string): Result.Result<unknown, readonly SettingProblem[]> {
  try {
    const parsed: unknown = JSON.parse(text);
    return Result.succeed(parsed);
  } catch {
    return Result.fail([problem(setting, '', 'Expected JSON')]);
  }
}

function decodedValueWith<A>(
  setting: string,
  value: unknown,
  decode: SettingDecoder<A>,
): Result.Result<A, readonly SettingProblem[]> {
  return Result.mapError(decode(value), ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
    formatIssues(issue).issues.map(({ message, path = [] }) =>
      problem(setting, pointerOf(path.filter((segment) => isPropertyKey(segment))), message),
    ),
  );
}

export function decodedJsonSettingWith<A>(
  setting: string,
  text: string,
  decode: SettingDecoder<A>,
): Result.Result<A, readonly SettingProblem[]> {
  return Result.flatMap(parsedJson(setting, text), (parsed) => decodedValueWith(setting, parsed, decode));
}

export function decodedSettingValue<S extends Schema.Codec<unknown, unknown>>(
  setting: string,
  value: unknown,
  schema: S,
): Result.Result<S['Type'], readonly SettingProblem[]> {
  return decodedValueWith(setting, value, Schema.decodeUnknownResult(schema, strictly));
}

export function decodedJsonSetting<S extends Schema.Codec<unknown, unknown>>(
  setting: string,
  text: string,
  schema: S,
): Result.Result<S['Type'], readonly SettingProblem[]> {
  return decodedJsonSettingWith(setting, text, Schema.decodeUnknownResult(schema, strictly));
}
