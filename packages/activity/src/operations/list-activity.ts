import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { activityOfPlaybooksToday } from '../entities/activity-of-playbooks.ts';
import { ActivityCountsSchema, countsFor, type ActivityCounts } from './activity-counts.ts';
import { ListActivityInputSchema } from './activity-input.ts';
import { activityStaleOn, listedBy, type ActivityServing } from './activity-listing.ts';
import { ActivityRowSchema, activityKinds, seenKinds, servedRow, type ServedActivityRow } from './activity-row.ts';
import { ThroughSchema, isSeenBy } from './activity-viewer.ts';
import { mostPlaybookChanges } from './playbook-register.ts';

const ListActivityOutputSchema = Schema.Struct({
  rows: Schema.Array(ActivityRowSchema).annotate({ description: 'The rows of the page, newest first by at' }),
  has_more: Schema.Boolean.annotate({ description: 'Whether more rows follow this page' }),
  next_cursor: Schema.NullOr(Schema.String).annotate({
    description: 'The cursor to pass as cursor for the next page, or null after the last',
  }),
  counts: ActivityCountsSchema,
  through: ThroughSchema,
});

const servedToday: ActivityServing<ServedActivityRow, ActivityCounts, never> = {
  kinds: activityKinds,
  playbooks: activityOfPlaybooksToday,
  rowsServed: (rows, viewer) =>
    Effect.succeed(rows.map((row) => servedRow(row, seenKinds.has(row.kind) ? isSeenBy(viewer, row) : null))),
  countsOf: countsFor,
};

export const listActivity = defineHttpOperation('org', 'query', {
  name: 'list_activity',
  staleOn: activityStaleOn,
  title: 'List activity',
  description: [
    'Lists the activity of the playbooks of the org the caller may access, newest first:',
    'the requests that wait on an answer, the definitions whose latest run broke,',
    `the runs, definitions and playbooks that are new, the playbooks from the newest ${mostPlaybookChanges} changes of the org's register,`,
    "and the open comments people made on them and, for a caller who may access every playbook, on the organization's own things.",
    'Each new and comment row says whether the caller has seen it, and the answer counts what waits on the caller and where they marked everything seen.',
  ].join(' '),
  route: { method: 'GET', path: '/activity' },
  permittedBy: ['org:read', 'playbook:read'],
  body: { kind: 'none' },
  inputSchema: ListActivityInputSchema,
  outputSchema: ListActivityOutputSchema,
  reasons: ['invalid_input', 'not_found'],
  handle: listedBy(servedToday),
});
