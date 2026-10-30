import { noStrippedForms, runnableAttributes, type StrippedForms } from '@on.auto/definitions';
import { Option, Schema } from 'effect';

export const ViewFilterSchema = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Json),
]);

export type ViewFilter = typeof ViewFilterSchema.Type;

export const ViewDetailsSchema = Schema.Struct({
  language: Schema.Literal('typescript'),
  fold: Schema.String,
  foldLine: Schema.Int,
  filters: Schema.Array(ViewFilterSchema),
  initial: Schema.Json,
  schema: Schema.optionalKey(Schema.JsonObject),
});

export type ViewDetails = typeof ViewDetailsSchema.Type;

const decodeDetails = Schema.decodeUnknownOption(ViewDetailsSchema);

export function viewDetailsOf(details: unknown): ViewDetails | undefined {
  return Option.getOrUndefined(decodeDetails(details));
}

export function runnableDetailsOf(details: unknown, stripped: StrippedForms = noStrippedForms): unknown {
  return Option.match(decodeDetails(details), {
    onNone: () => details,
    onSome: (decoded): ViewDetails => ({
      ...decoded,
      fold: stripped.module ?? decoded.fold,
      filters: decoded.filters.map((filter) => ({ ...runnableAttributes(filter, stripped), type: filter.type })),
    }),
  });
}

export function lineInDocument({ foldLine }: ViewDetails, line: number): number {
  return foldLine + line - 1;
}
