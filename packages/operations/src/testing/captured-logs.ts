import { Logger, Schema, type Layer } from 'effect';

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

export interface CapturedLogs {
  readonly layer: Layer.Layer<never>;
  readonly loggers: ReadonlySet<Logger.Logger<unknown, void>>;
  readonly logged: () => readonly CapturedLog[];
  readonly text: () => string;
}

export function capturedLogs(): CapturedLogs {
  const captured: CapturedLog[] = [];
  const lines: string[] = [];
  const logger = Logger.map(Logger.formatJson, (line: string) => {
    const { message, level, annotations = {} } = decodeLine(line);
    lines.push(line);
    captured.push({ message: String(message), level, annotations });
  });
  return {
    layer: Logger.layer([logger]),
    loggers: new Set([logger]),
    logged: () => captured,
    text: () => lines.join('\n'),
  };
}
