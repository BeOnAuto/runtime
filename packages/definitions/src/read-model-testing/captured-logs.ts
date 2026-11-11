import { Logger, Schema } from 'effect';

export interface CapturedLog {
  readonly message: string;
  readonly level: string;
  readonly annotations: Readonly<Record<string, unknown>>;
}

const decodeLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.Unknown,
      level: Schema.String,
      annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
);

export function capturedLogs() {
  const captured: CapturedLog[] = [];
  const logger = Logger.map(Logger.formatJson, (line: string) => {
    const { message, level, annotations = {} } = decodeLine(line);
    captured.push({ message: String(message), level, annotations });
  });
  return { logger, logged: (): readonly CapturedLog[] => captured };
}
