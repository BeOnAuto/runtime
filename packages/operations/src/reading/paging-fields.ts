import { Schema } from 'effect';

import { isCalendarDay } from './calendar-days.ts';
import { mostRecordsInAPage } from './page-bounds.ts';

export const defaultPageLimit = 20;

const longestCursor = 512;

const isoTime =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

function isTime(text: string): boolean {
  return isoTime.test(text) && isCalendarDay(text.slice(0, 10)) && Number.isFinite(Date.parse(text));
}

export const PagingInputFields = {
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: mostRecordsInAPage })).annotate({
      description: `The most items to answer with, from 1 to ${mostRecordsInAPage}; ${defaultPageLimit} when left out`,
    }),
  ),
  cursor: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(longestCursor)).annotate({
      description: 'The next_cursor of the page before, or the cursor of an item, to read on after it',
    }),
  ),
  order: Schema.optionalKey(
    Schema.Literals(['asc', 'desc']).annotate({ description: 'asc for oldest first, desc for newest first' }),
  ),
  since: Schema.optionalKey(
    Schema.String.annotate({ description: 'A time in ISO 8601; only what was recorded from then on' }).check(
      Schema.makeFilter(isTime, { expected: 'a time in ISO 8601 with its offset, such as 2026-10-05T09:00:00Z' }),
    ),
  ),
  type: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The public name of one type of event' }),
  ),
};

export const PagingOutputFields = {
  has_more: Schema.Boolean.annotate({ description: 'Whether more remains to read after this page' }),
  next_cursor: Schema.NullOr(Schema.String).annotate({
    description: 'The cursor that reads the page after this one, null when nothing remains',
  }),
};

export const EventPagingInputFields = {
  limit: PagingInputFields.limit,
  cursor: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(longestCursor)).annotate({
      description: 'The next_cursor of the page before, to read on after it',
    }),
  ),
  order: PagingInputFields.order,
  since: PagingInputFields.since,
};

export const EventPagingOutputFields = {
  has_more: Schema.Boolean.annotate({
    description: 'Whether more remains to read after this page, which may hold fewer events than its limit, or none',
  }),
  next_cursor: Schema.NullOr(Schema.String).annotate({
    description: 'The cursor that reads the page after this one, null when nothing remains',
  }),
};
