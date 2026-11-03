import { Option, Schema } from 'effect';

import { OutputShapeNameSchema } from '../shapes/shape-names.ts';

const EventFilterSchema = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Json),
]);

const PageDataDetailsSchema = Schema.Struct({
  views: Schema.Record(Schema.String, OutputShapeNameSchema),
  language: Schema.Literal('typescript'),
  fold: Schema.String,
  foldLine: Schema.Int,
  filters: Schema.Array(EventFilterSchema),
});

export const PageDetailsSchema = Schema.Struct({ data: Schema.optionalKey(PageDataDetailsSchema) });

export type PageDetails = typeof PageDetailsSchema.Type;

const decodeDetails = Schema.decodeUnknownOption(PageDetailsSchema);

export function pageDetailsIn(details: unknown): PageDetails | undefined {
  return Option.getOrUndefined(decodeDetails(details));
}
