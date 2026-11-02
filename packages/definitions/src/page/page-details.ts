import { Option, Schema } from 'effect';

import { OutputShapeNameSchema } from '../shapes/shape-names.ts';
import { subjectIn, type DefinitionSubject } from './page-subjects.ts';

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

export const PageDetailsSchema = Schema.Struct({
  of: Schema.String,
  data: Schema.optionalKey(PageDataDetailsSchema),
});

export type PageDetails = typeof PageDetailsSchema.Type;

export const encodePageDetails = Schema.encodeSync(PageDetailsSchema);

const decodeDetails = Schema.decodeUnknownOption(PageDetailsSchema);

export function pageDetailsIn(details: unknown): PageDetails | undefined {
  return Option.getOrUndefined(decodeDetails(details));
}

export function pageSubjectOf(details: unknown): string | undefined {
  return pageDetailsIn(details)?.of;
}

export function definitionPresentedBy(details: unknown): DefinitionSubject | undefined {
  const reading = subjectIn(pageSubjectOf(details) ?? '');
  return 'subject' in reading && reading.subject !== 'playbook' ? reading.subject : undefined;
}

export function publishedPageDetails(details: unknown): Schema.JsonObject {
  const read = pageDetailsIn(details);
  if (read === undefined) {
    return {};
  }
  return read.data === undefined ? { of: read.of } : { of: read.of, views: read.data.views };
}
