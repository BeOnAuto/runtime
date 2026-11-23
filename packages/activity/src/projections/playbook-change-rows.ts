import { recordedDecoder, type KeyedProjection, type ProjectedKeyedRow, type ProjectedRow } from '@on.auto/operations';
import { PlaybookEventSchema, playbooksStream } from '@on.auto/playbooks';
import { Option, Schema } from 'effect';

import type { ActivityRow } from '../operations/activity-row.ts';
import { playbookChangeKeyOf } from '../positions/activity-addresses.ts';
import { millisecondsOf } from './activity-facts.ts';

export const playbookChangeRowsName = 'playbook_changes';

export const changedPositionColumn = 'position';

const playbookFactOf = recordedDecoder(PlaybookEventSchema);

type PlaybookFact = typeof PlaybookEventSchema.Type;

const PlaybookChangeRowSchema = Schema.Struct({
  playbook: Schema.String,
  at: Schema.Int,
  by: Schema.String,
  change: Schema.Literals(['created', 'updated']),
  position: Schema.Int,
});

const playbookChangeRowOf = Schema.decodeUnknownSync(PlaybookChangeRowSchema);

function changeRowOf(fact: PlaybookFact, position: number): ProjectedRow | undefined {
  if (fact.type === 'playbook_retired' || fact.type === 'playbook_restored') {
    return undefined;
  }
  return {
    playbook: fact.data.playbook,
    at: millisecondsOf(fact.context.at),
    by: fact.type === 'playbook_created' ? fact.data.created_by.id : fact.context.by,
    change: fact.type === 'playbook_created' ? 'created' : 'updated',
    position,
  };
}

const playbookChangeRowsLayout = 32;

export const playbookChangeRowsLayoutSteps = [{ layout: playbookChangeRowsLayout, statements: [] }] as const;

export const playbookChangeRows: KeyedProjection = {
  name: playbookChangeRowsName,
  version: 1,
  scopes: ['org'],
  kinds: [playbooksStream],
  types: ['playbook_created', 'playbook_updated'],
  columns: [
    { name: 'playbook', kind: 'text' },
    { name: 'at', kind: 'integer' },
    { name: 'by', kind: 'text' },
    { name: 'change', kind: 'text' },
    { name: changedPositionColumn, kind: 'integer' },
  ],
  indexes: [],
  keyOf: (message) => message.id,
  rowAfter: (row, message) =>
    row === undefined
      ? Option.getOrUndefined(
          Option.flatMapNullishOr(playbookFactOf(message), (fact) => changeRowOf(fact, message.position)),
        )
      : undefined,
};

export function playbookChangeOf({ row }: ProjectedKeyedRow): ActivityRow {
  const { playbook, at, by, change } = playbookChangeRowOf(row);
  return {
    kind: 'new',
    form: 'playbook',
    position: { at, playbook, key: playbookChangeKeyOf(at) },
    by,
    by_name: null,
    change,
    trigger: null,
    definition: null,
    run_id: null,
    output_shape: null,
    message: null,
    answer_schema: null,
    detail: null,
    status: null,
    waits_on: null,
    expires_at: null,
    about: null,
  };
}
