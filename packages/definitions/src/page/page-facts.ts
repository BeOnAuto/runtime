import { ActedContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

import { StrippedFormsSchema } from '../capability/stripped-forms.ts';
import { PageDetailsSchema } from './page-details.ts';

export const PageContentSchema = Schema.Struct({
  details: PageDetailsSchema,
  stripped: Schema.optionalKey(StrippedFormsSchema),
});

export type PageContent = typeof PageContentSchema.Type;

const PlaybookPageSchema = Schema.Struct({ source: Schema.String, ...PageContentSchema.fields });

export const PageEventSchema = Schema.Union([
  factOf('playbook_page_saved', Schema.Struct({ page: Schema.NullOr(PlaybookPageSchema) }), ActedContextSchema),
]);

export type RecordedPageEvent = typeof PageEventSchema.Type;

export interface SubjectPage {
  readonly version: number;
  readonly source: string;
  readonly details: PageContent['details'];
}

export type PageStanding = Omit<SubjectPage, 'source'>;
