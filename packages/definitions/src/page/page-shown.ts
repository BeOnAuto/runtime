import { Schema } from 'effect';

import { RunDetailSchema } from '../runs/run.ts';

const PageShownSchema = Schema.Struct({
  result: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "The run as its subject's page shows it, Markdown whose first line is the run's headline; on get_run of a run of a subject that has a page, and in a page's preview",
    }),
  ),
  runs: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "The subject's runs so far as its page shows them, Markdown with charts as fenced blocks; on get_definition of a subject that has a page, and in a page's preview",
    }),
  ),
}).annotate({ description: 'What the page of the subject renders when it is read, each block it has' });

export const RunReadSchema = Schema.Struct({
  ...RunDetailSchema.fields,
  page: Schema.optionalKey(PageShownSchema),
}).annotate({
  identifier: 'RunRead',
  description:
    'One run as get_run reads it: how it ended, what its runtime adapter recorded, and its page where its definition has one',
});
