import {
  Caller,
  Forbidden,
  OrgWriter,
  canAccessPlaybook,
  defineHttpOperation,
  type CallerIdentity,
  type InvalidInput,
} from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { activityStreamOf, seenDecider, type SeenItem } from '../facts/activity-seen.ts';
import { itemOfAddress } from '../positions/activity-addresses.ts';
import { countsFor } from './activity-counts.ts';
import {
  AddressField,
  addressOfCaller,
  cursorField,
  mostRowsInAPage,
  positionAt,
  refusedAt,
} from './activity-input.ts';
import { isoOf } from './activity-row.ts';
import { throughOf, viewerOf } from './activity-viewer.ts';
import { ActivityCountsSchema, ThroughSchema } from './list-activity.ts';
import { loadPlaybookRegister } from './playbook-register.ts';

const SeenItemSchema = Schema.Struct({
  address: Schema.String.annotate({ description: 'The address of the row, as the row gives it' }),
  at: Schema.String.annotate({ description: 'The at of the row, as the row gives it' }),
});

const MarkActivitySeenInputSchema = Schema.Struct({
  items: Schema.optionalKey(
    Schema.Array(SeenItemSchema)
      .check(Schema.isMaxLength(mostRowsInAPage))
      .annotate({
        description: `The new and comment rows the caller has seen, each its address and its at, at most ${mostRowsInAPage}`,
      }),
  ),
  through: Schema.optionalKey(cursorField('A cursor from a read: everything at or before it is seen')),
  address: Schema.optionalKey(AddressField),
});

type MarkActivitySeenInput = typeof MarkActivitySeenInputSchema.Type;

const MarkActivitySeenOutputSchema = Schema.Struct({ counts: ActivityCountsSchema, through: ThroughSchema });

const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

function seenItemAt(
  caller: CallerIdentity,
  { address, at }: SeenItem,
  index: number,
): Effect.Effect<SeenItem, InvalidInput | Forbidden> {
  const item = itemOfAddress(address);
  const time = Date.parse(at);
  if (item === undefined || !isoTime.test(at) || !Number.isSafeInteger(time)) {
    return Effect.fail(
      refusedAt(`/items/${index}`, 'Expected the address of a row of the activity and its at, in ISO 8601'),
    );
  }
  return canAccessPlaybook(caller.playbooks, item.playbook)
    ? Effect.succeed({ address, at: isoOf(time) })
    : Effect.fail(new Forbidden({ detail: `The caller may not access the playbook ${item.playbook}` }));
}

const marked = Effect.fnUntraced(function* ({ items = [], through: cursor, address: asked }: MarkActivitySeenInput) {
  const caller = yield* Caller;
  if (items.length === 0 && cursor === undefined) {
    return yield* refusedAt('/items', 'Expected the items seen, a through, or both');
  }
  const register = yield* loadPlaybookRegister;
  const seen = yield* Effect.forEach(items, (item, index) => seenItemAt(caller, item, index));
  const through = yield* positionAt('through', cursor, register);
  const address = yield* addressOfCaller(asked);
  yield* (yield* OrgWriter).execute(activityStreamOf(caller.id), seenDecider, {
    items: seen,
    ...(through === undefined ? {} : { through: { ...through, at: isoOf(through.at) } }),
    at: DateTime.formatIso(yield* DateTime.now),
    by: caller.id,
  });
  const viewer = yield* viewerOf(caller.id, address);
  const readable = [...register.active].filter((each) => canAccessPlaybook(caller.playbooks, each)).toSorted();
  return {
    counts: yield* countsFor({ viewer, readable, changes: register.changes }),
    through: throughOf(viewer.seen),
  };
});

export const markActivitySeen = defineHttpOperation('org', 'command', {
  name: 'mark_activity_seen',
  title: 'Mark activity seen',
  description: [
    'Records that the caller has seen new and comment rows of the activity, by their address and at, everything through a cursor of a read, or both.',
    "It changes what the caller has seen alone, and answers the caller's counts and through after it.",
  ].join(' '),
  route: { method: 'POST', path: '/activity/seen' },
  permittedBy: ['org:read', 'playbook:read'],
  body: { kind: 'json' },
  inputSchema: MarkActivitySeenInputSchema,
  outputSchema: MarkActivitySeenOutputSchema,
  reasons: ['invalid_input', 'forbidden', 'conflict'],
  handle: marked,
});
