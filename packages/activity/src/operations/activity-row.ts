import { Schema } from 'effect';

import { addressOf, type ItemForm } from '../positions/activity-addresses.ts';
import { cursorOf, type ActivityPosition } from '../positions/activity-position.ts';

export type ActivityKind = 'needs_you' | 'broken' | 'new';

export const activityKinds: readonly ActivityKind[] = ['needs_you', 'broken', 'new'];

export interface ActivityRow {
  readonly kind: ActivityKind;
  readonly form: ItemForm;
  readonly position: ActivityPosition;
  readonly by: string;
  readonly change: 'created' | 'updated' | null;
  readonly trigger: { readonly kind: string; readonly reference: string } | null;
  readonly definition: { readonly type: string; readonly name: string; readonly version: number } | null;
  readonly run_id: string | null;
  readonly output_shape: string | null;
  readonly message: string | null;
  readonly answer_schema: Schema.JsonObject | null;
  readonly detail: string | null;
  readonly status: 'failed' | 'rejected' | null;
  readonly waits_on: string | null;
  readonly expires_at: number | null;
}

const NullableText = (description: string) => Schema.NullOr(Schema.String).annotate({ description });

export const ActivityRowSchema = Schema.Struct({
  kind: Schema.Literals(activityKinds).annotate({ description: 'needs_you, broken or new' }),
  address: Schema.String.annotate({ description: 'The address of the item, which mark_activity_seen takes' }),
  cursor: Schema.String.annotate({
    description: 'The place of the row in the activity, which since, cursor and through take',
  }),
  playbook: Schema.String.annotate({ description: 'The id of the playbook the item belongs to' }),
  at: Schema.String.annotate({ description: 'When the item came about, by its kind, in ISO 8601 UTC' }),
  by: Schema.String.annotate({
    description:
      'The id of the caller who started the run, saved the version or changed the playbook; for a request, who started the run that asked',
  }),
  change: Schema.NullOr(Schema.Literals(['created', 'updated'])).annotate({
    description: 'For a version or a playbook, created or updated; otherwise null',
  }),
  trigger: Schema.NullOr(Schema.Struct({ kind: Schema.String, reference: Schema.String })).annotate({
    description: 'For a run a trigger started, its kind, event, cron or every, and its reference; otherwise null',
  }),
  definition: Schema.NullOr(Schema.Struct({ type: Schema.String, name: Schema.String, version: Schema.Int })).annotate({
    description:
      'The type, name and version of the definition; for broken, the version it broke on; null for a playbook',
  }),
  run_id: NullableText('The run that asked, the latest run that broke, or the run that succeeded; otherwise null'),
  output_shape: NullableText(
    'For a run that succeeded, the output shape its output takes, where it takes one; otherwise null',
  ),
  message: NullableText(
    "For needs_you, the first line of the request's message, at most 200 characters; otherwise null",
  ),
  answer_schema: Schema.NullOr(Schema.JsonObject).annotate({
    description: 'For needs_you, the JSON Schema the answer takes, where it is at most 8 KiB as JSON; otherwise null',
  }),
  detail: NullableText(
    "For broken, the detail of the latest failing run's rejection, at most 200 characters; otherwise null",
  ),
  status: Schema.NullOr(Schema.Literals(['failed', 'rejected'])).annotate({
    description: 'For broken, whether the latest failing run failed or was rejected; otherwise null',
  }),
  waits_on: NullableText('For needs_you, the address the request names, in lower case, or any_member; otherwise null'),
  expires_at: NullableText('For needs_you, when the request expires unanswered, in ISO 8601 UTC; otherwise null'),
  seen: Schema.NullOr(Schema.Boolean).annotate({
    description: 'For new, whether the caller has seen it; null for the other kinds',
  }),
}).annotate({ identifier: 'ActivityRow', description: 'An item of the activity of the org' });

export type ServedActivityRow = typeof ActivityRowSchema.Type;

export function isoOf(time: number): string {
  return new Date(time).toISOString();
}

export function addressOfRow({ form, position: { playbook, key } }: ActivityRow): string {
  return addressOf({ form, playbook, key });
}

export function servedRow(
  { form, position, expires_at: expiresAt, ...row }: ActivityRow,
  seen: boolean | null,
): ServedActivityRow {
  return {
    ...row,
    address: addressOf({ form, playbook: position.playbook, key: position.key }),
    cursor: cursorOf(position),
    playbook: position.playbook,
    at: isoOf(position.at),
    expires_at: expiresAt === null ? null : isoOf(expiresAt),
    seen,
  };
}
