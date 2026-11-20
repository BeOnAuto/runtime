import { Schema } from 'effect';

const LogLineSchema = Schema.Struct({ message: Schema.String, level: Schema.String });

const decodeLogLine = Schema.decodeUnknownSync(Schema.fromJsonString(LogLineSchema));

export function messagesOf(stderr: string): readonly string[] {
  return stderr
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => decodeLogLine(line).message);
}

const ModelLineSchema = Schema.Struct({
  message: Schema.String,
  level: Schema.String,
  annotations: Schema.Record(Schema.String, Schema.Unknown),
});

type ModelLine = typeof ModelLineSchema.Type;

const decodeModelLine = Schema.decodeUnknownSync(Schema.fromJsonString(ModelLineSchema));

export function modelLinesOf(stderr: string): readonly ModelLine[] {
  return stderr
    .split('\n')
    .filter((line) => /"message":"(?:Model provider|No model provider)/u.test(line))
    .map((line) => {
      const { message, level, annotations } = decodeModelLine(line);
      return { message, level, annotations };
    });
}

const AnnotatedLineSchema = Schema.Struct({ annotations: Schema.Record(Schema.String, Schema.Unknown) });

const decodeAnnotatedLine = Schema.decodeUnknownSync(Schema.fromJsonString(AnnotatedLineSchema));

export function annotationsOf(stderr: string): readonly Readonly<Record<string, unknown>>[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => decodeAnnotatedLine(line).annotations);
}
