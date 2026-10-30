import { Effect, Schema, SchemaGetter, type SchemaIssue } from 'effect';

export const stateFormat = 10;

export const StateFormatSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const ThisFormatOrNewerSchema = StateFormatSchema.check(Schema.isGreaterThanOrEqualTo(stateFormat));

export interface OlderFormat {
  readonly format: number;
  readonly initial: unknown;
  readonly read: (state: unknown) => unknown;
  readonly upcast: (state: unknown) => unknown;
}

export interface StateFormats {
  readonly current: number;
  readonly older: readonly OlderFormat[];
}

interface RecordNames<Written, Current> {
  readonly current: (written: Written) => Current;
  readonly written: (current: Current) => unknown;
}

export function writtenInAnOlderFormat<Written, Type, Current>(
  written: Schema.Decoder<Written>,
  current: Schema.Codec<Type, Current>,
  names: RecordNames<Written, Current>,
) {
  const read = Schema.decodeUnknownEffect(written);
  return Schema.Unknown.pipe(
    Schema.decodeTo(current, {
      decode: SchemaGetter.transformEffect((record: unknown, options) =>
        read(record, { ...options, onExcessProperty: 'error' }).pipe(
          Effect.mapBoth({
            onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) => issue,
            onSuccess: names.current,
          }),
        ),
      ),
      encode: SchemaGetter.transform(names.written),
    }),
  );
}
