import { definitionOfStreamPrefix, type ProjectedKeyedRow } from '@on.auto/operations';
import type { HeldName } from '@on.auto/operations/definition-names';
import { Option, Schema } from 'effect';

import { commentKeyOf } from '../positions/activity-addresses.ts';
import { commentTargetOf, type CommentTarget } from '../positions/comment-addresses.ts';
import { addressedAsHeld } from '../positions/definition-addresses.ts';
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

function commentOf(playbook: string, id: string, columns: CommentColumns, definition: string | undefined): ActivityRow {
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
    ...(definition === undefined ? {} : { definitionId: definition }),
    ...(columns.reopened_by === null ? {} : { reopenedBy: columns.reopened_by }),
  };
}

export function commentRowsOf(playbook: string, { key, row, definition }: ProjectedKeyedRow): readonly ActivityRow[] {
  return Option.toArray(commentColumnsOf(row)).map((columns) => commentOf(playbook, key, columns, definition));
}

interface NamesAsked {
  readonly playbook: string;
  readonly type: string;
}

interface OnADefinition extends NamesAsked {
  readonly definition: string;
  readonly about: string;
}

function onADefinition({ kind, position, definition, definitionId, about }: ActivityRow): OnADefinition | undefined {
  return kind === 'comment' && definition !== null && definitionId !== undefined && about !== null
    ? { playbook: position.playbook, type: definition.type, definition: definitionId, about }
    : undefined;
}

export function namesAskedBy(rows: readonly ActivityRow[]): readonly NamesAsked[] {
  const asked = rows.flatMap((row) => onADefinition(row) ?? []);
  return [
    ...new Map(asked.map(({ playbook, type }) => [JSON.stringify([playbook, type]), { playbook, type }])).values(),
  ];
}

function heldKeyOf(playbook: string, definition: string): string {
  return JSON.stringify([playbook, definition]);
}

export function heldByDefinition(
  { playbook }: NamesAsked,
  held: readonly HeldName[],
): readonly (readonly [string, HeldName])[] {
  return held.flatMap((name) =>
    Option.toArray(definitionOfStreamPrefix(name.definitionKey)).map(
      ({ definition }) => [heldKeyOf(playbook, definition), name] as const,
    ),
  );
}

export function commentNamedNow(row: ActivityRow, names: ReadonlyMap<string, HeldName>): ActivityRow {
  const on = onADefinition(row);
  const held = on === undefined ? undefined : names.get(heldKeyOf(on.playbook, on.definition));
  if (on === undefined || held === undefined) {
    return row;
  }
  const { address } = addressedAsHeld({ address: on.about }, held);
  return { ...row, about: address, definition: definitionNamedBy(commentTargetOf(address)) };
}
