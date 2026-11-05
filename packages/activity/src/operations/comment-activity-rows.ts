import type { ProjectedKeyedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { commentKeyOf } from '../positions/activity-addresses.ts';
import { commentTargetOf, type CommentTarget } from '../positions/comment-addresses.ts';
import { lineOf } from '../projections/activity-facts.ts';
import type { ActivityRow } from './activity-row.ts';

const CommentColumnsSchema = Schema.Struct({
  address: Schema.String,
  text: Schema.String,
  by: Schema.String,
  by_name: Schema.String,
  listed_at: Schema.Int,
  reopened_by: Schema.NullOr(Schema.String),
});

const commentColumnsOf = Schema.decodeUnknownOption(CommentColumnsSchema);

type CommentColumns = typeof CommentColumnsSchema.Type;

function definitionNamedBy(target: CommentTarget | undefined) {
  return target?.kind === 'definition' || target?.kind === 'step'
    ? { type: target.type, name: target.name, version: target.version }
    : null;
}

function runNamedBy(target: CommentTarget | undefined): string | null {
  return target !== undefined && 'run' in target ? target.run : null;
}

function commentOf(playbook: string, id: string, columns: CommentColumns): ActivityRow {
  const target = commentTargetOf(columns.address);
  return {
    kind: 'comment',
    form: 'comment',
    position: { at: columns.listed_at, playbook, key: commentKeyOf(id) },
    by: columns.by,
    by_name: columns.by_name,
    change: null,
    trigger: null,
    definition: definitionNamedBy(target),
    run_id: runNamedBy(target),
    output_shape: null,
    message: lineOf(columns.text),
    answer_schema: null,
    detail: null,
    status: null,
    waits_on: null,
    expires_at: null,
    about: columns.address,
    sign_in: null,
    approval: null,
    ...(columns.reopened_by === null ? {} : { reopenedBy: columns.reopened_by }),
  };
}

export function commentRowsOf(playbook: string, { key, row }: ProjectedKeyedRow): readonly ActivityRow[] {
  return Option.toArray(commentColumnsOf(row)).map((columns) => commentOf(playbook, key, columns));
}
