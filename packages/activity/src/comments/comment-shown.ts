import { withStudioLink, type CommentedPlace, type ProjectedKeyedRow } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { ResolvedHowSchema, type CommentState } from '../facts/comment-facts.ts';
import { commentTargetOf, type CommentTarget } from '../positions/comment-addresses.ts';

const NullableText = (description: string) => Schema.NullOr(Schema.String).annotate({ description });

export const CommentSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the comment, a UUIDv7 the runtime gives it' }),
  address: Schema.String.annotate({ description: 'The address of what the comment is about' }),
  text: Schema.String.annotate({ description: 'What the person said, in Markdown' }),
  by: Schema.String.annotate({ description: 'The id of the caller who made it' }),
  by_name: Schema.String.annotate({ description: 'The name of the caller who made it, as the runtime names them' }),
  at: Schema.String.annotate({ description: 'When it was made, in ISO 8601 UTC' }),
  open: Schema.Boolean.annotate({ description: 'true until it is resolved' }),
  resolved_at: NullableText('When it was resolved, in ISO 8601 UTC; null while it is open'),
  resolved_by: NullableText('The id of the caller who resolved it; null while it is open'),
  resolved_how: Schema.NullOr(ResolvedHowSchema).annotate({
    description: 'acted, done as it asked, or dismissed, closed without acting; null while it is open',
  }),
  studio: Schema.optionalKey(
    Schema.String.annotate({
      description: "The comment's place in Studio, which opens its address and shows the comment beside it",
    }),
  ),
}).annotate({ identifier: 'Comment', description: 'A comment a person made on something of the playbook' });

type ShownComment = typeof CommentSchema.Type;

type KeptComment = Omit<ShownComment, 'studio'>;

const CommentColumnsSchema = Schema.Struct({
  address: Schema.String,
  text: Schema.String,
  by: Schema.String,
  by_name: Schema.String,
  at: Schema.Int,
  open: Schema.Boolean,
  resolved_at: Schema.NullOr(Schema.Int),
  resolved_by: Schema.NullOr(Schema.String),
  resolved_how: Schema.NullOr(ResolvedHowSchema),
});

const commentColumnsOf = Schema.decodeUnknownOption(CommentColumnsSchema);

function isoOf(time: number): string {
  return new Date(time).toISOString();
}

export function keptOfState(id: string, { address, text, madeBy, at, resolution }: CommentState): KeptComment {
  return {
    id,
    address,
    text,
    by: madeBy.id,
    by_name: madeBy.name,
    at,
    open: resolution === null,
    resolved_at: resolution?.at ?? null,
    resolved_by: resolution?.by ?? null,
    resolved_how: resolution?.how ?? null,
  };
}

function keptOfColumns(id: string, columns: typeof CommentColumnsSchema.Type): KeptComment {
  return {
    id,
    address: columns.address,
    text: columns.text,
    by: columns.by,
    by_name: columns.by_name,
    at: isoOf(columns.at),
    open: columns.open,
    resolved_at: columns.resolved_at === null ? null : isoOf(columns.resolved_at),
    resolved_by: columns.resolved_by,
    resolved_how: columns.resolved_how,
  };
}

export function keptOfRow({ key, row }: ProjectedKeyedRow): readonly KeptComment[] {
  return Option.toArray(commentColumnsOf(row)).map((columns) => keptOfColumns(key, columns));
}

type OnARun = Extract<CommentTarget, { kind: 'run' | 'event' | 'block' | 'request' }>;

function runPlaceOf(target: OnARun): CommentedPlace {
  if (target.kind === 'event') {
    return { kind: 'run', run: target.run, event: target.event };
  }
  return target.kind === 'block'
    ? { kind: 'run', run: target.run, block: target.block }
    : { kind: 'run', run: target.run };
}

function placeOf(target: CommentTarget): CommentedPlace {
  if (target.kind === 'playbook') {
    return { kind: 'playbook' };
  }
  if (target.kind === 'definition' || target.kind === 'step') {
    const { type, name, version } = target;
    return target.kind === 'step'
      ? { kind: 'definition', type, name, version, step: target.step }
      : { kind: 'definition', type, name, version };
  }
  return runPlaceOf(target);
}

export function shownComment(comment: KeptComment): Effect.Effect<ShownComment> {
  const target = commentTargetOf(comment.address);
  return target === undefined
    ? Effect.succeed(comment)
    : withStudioLink(comment, { kind: 'comment', playbook: target.playbook, comment: comment.id, on: placeOf(target) });
}
