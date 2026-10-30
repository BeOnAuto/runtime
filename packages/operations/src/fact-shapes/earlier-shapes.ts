import { Effect, Schema, SchemaGetter, SchemaIssue } from 'effect';

export type EarlierShape<Fact> = (current: Schema.Codec<Fact, unknown>) => Schema.Codec<Fact, unknown>;

function raisedBy<Earlier, Fact>(raise: (fact: Earlier) => Fact): SchemaGetter.Getter<Fact, Earlier> {
  return SchemaGetter.transformEffect((fact, options) =>
    Effect.try({
      try: () => raise(fact),
      catch: (refusal) =>
        new SchemaIssue.InvalidValue(
          { message: `The reader of an earlier shape could not raise the fact: ${String(refusal)}` },
          fact,
          options,
        ),
    }),
  );
}

export function earlierShapeOf<Earlier extends Schema.Codec<unknown, unknown>, Fact>(
  earlier: Earlier,
  raise: (fact: Earlier['Type']) => Fact,
): EarlierShape<Fact> {
  return (current) =>
    earlier.pipe(
      Schema.decodeTo(Schema.toType(current), {
        decode: raisedBy(raise),
        encode: SchemaGetter.forbiddenEncoding,
      }),
    );
}

export function readingEarlierShapes<Fact, Current extends Schema.Codec<Fact, unknown>>(
  current: Current,
  earlier: readonly EarlierShape<Fact>[],
): Schema.Union<readonly [Current, ...Schema.Codec<Fact, unknown>[]]> {
  return Schema.Union([current, ...earlier.map((shape) => shape(current))]);
}
