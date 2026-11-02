import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';

import { activityPlaybookOn, madePlaybook, type ActivityPlaybook } from '../activity/activity-playbook.ts';
import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';

export const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: '*' });

export const commentKeys = { API_KEYS: JSON.stringify([admin.entry, reader.entry]) };

const CommentSchema = Schema.Struct({
  id: Schema.String,
  address: Schema.String,
  text: Schema.String,
  by: Schema.String,
  open: Schema.Boolean,
  resolved_how: Schema.NullOr(Schema.String),
});

export const commentOf = Schema.decodeUnknownSync(CommentSchema);

export const commentsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    comments: Schema.Array(CommentSchema),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
);

const EventsSchema = Schema.Struct({ events: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String })) });

export interface CommentedPlaybook {
  readonly ofTheAdmin: ActivityPlaybook;
  readonly ofTheReader: ActivityPlaybook;
  readonly run: string;
  readonly event: string;
}

export async function commentedPlaybook(server: ReasoningServer): Promise<CommentedPlaybook> {
  const ofTheAdmin = await madePlaybook(server, 'acme', admin.key);
  const run = await ofTheAdmin.ran('computation', 'tally', { fail: false });
  await ofTheAdmin.settled(run);
  const { events } = Schema.decodeUnknownSync(EventsSchema)(
    (await ofTheAdmin.call('GET', `${ofTheAdmin.playbook}/events?run_id=${run}`)).body,
  );
  return { ofTheAdmin, ofTheReader: activityPlaybookOn(server, 'acme', reader.key), run, event: events[0].id };
}

export function addressesOn({ run, event }: CommentedPlaybook) {
  return {
    version: 'alpha/definitions/computation/tally/1',
    step: 'alpha/definitions/workflow/approval/1/steps/do/0/approve',
    run: `alpha/runs/${run}`,
    event: `alpha/runs/${run}/events/${event}`,
    block: `alpha/runs/${run}/result/1`,
    playbook: 'playbooks/alpha',
    request: `alpha/${run}`,
  };
}
