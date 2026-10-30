import { Config, ConfigProvider, Effect, Option, Result, type Schema } from 'effect';

import { describeIssues, failureOf, within } from './issues.ts';

export type Environment = Readonly<Record<string, string | undefined>>;

export type SettingDecoder<T> = (text: string) => Result.Result<T, Schema.SchemaError>;

export function readJsonSetting<T>(
  environment: Environment,
  setting: string,
  decode: SettingDecoder<T>,
): Result.Result<Option.Option<T>, string> {
  const text = Effect.runSync(
    Config.String(setting).pipe(Config.withDefault('')).parse(ConfigProvider.fromEnvRecord(environment)),
  ).trim();
  if (text === '') {
    return Result.succeed(Option.none());
  }
  const decoded = decode(text);
  return Result.isSuccess(decoded)
    ? Result.succeed(Option.some(decoded.success))
    : Result.fail(describeIssues(failureOf(decoded.failure.issue), within(setting)));
}
