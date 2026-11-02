import type { PlaybookReader } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { DefinitionKind } from '../capability/definition-kinds.ts';
import { RunDetailSchema, type RunDetail } from '../runs/run.ts';
import { presentedPageOf, runShownOf, storedSubjectOf, subjectPageOf, subjectShownOf } from './page-reads.ts';
import { PageShownSchema } from './page-shown.ts';
import { subjectNamed } from './page-subjects.ts';

export const RunReadSchema = Schema.Struct({
  ...RunDetailSchema.fields,
  page: Schema.optionalKey(PageShownSchema),
}).annotate({
  identifier: 'RunRead',
  description:
    'One run as get_run reads it: how it ended, what its runtime adapter recorded, and its page where its definition has one',
});

type RunRead = typeof RunReadSchema.Type;

export const pageResultWith = Effect.fnUntraced(function* (
  capabilities: readonly DefinitionKind[],
  detail: RunDetail,
): Effect.fn.Return<RunRead, never, PlaybookReader> {
  const found = yield* subjectPageOf(capabilities, subjectNamed(detail.type, detail.name));
  if (found === undefined) {
    return detail;
  }
  const subject = subjectShownOf(detail.type, yield* storedSubjectOf(detail.type, detail.name));
  const result = yield* found.presents.resultOf(presentedPageOf(found.page), runShownOf(detail), subject);
  return result === undefined ? detail : { ...detail, page: { result } };
});
