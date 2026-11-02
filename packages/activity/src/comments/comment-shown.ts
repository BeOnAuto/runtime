import { withStudioLink, type CommentedPlace, type ProjectedKeyedRow, type StudioPage } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { ResolvedHowSchema, fractionOf, type CommentState } from '../facts/comment-facts.ts';
import { commentTargetOf, type CommentTarget, type OfTheOrg } from '../positions/comment-addresses.ts';

const NullableText = (description: string) => Schema.NullOr(Schema.String).annotate({ description });

export const CommentSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the comment, a UUIDv7 the runtime gives it' }),
  address: Schema.String.annotate({ description: 'The address of what the comment is about' }),
  text: Schema.String.annotate({ description: 'What the person said, in Markdown' }),
  anchor: Schema.NullOr(Schema.Struct({ x: Schema.Number, y: Schema.Number })).annotate({
    description:
      "Where on the thing the person dropped it, { x, y }, each a fraction of the thing's box from 0 to 1; null for a comment made without one",
  }),
  by: Schema.String.annotate({ description: 'The id of the caller who made it' }),
  by_name: Schema.String.annotate({ description: 'The name of the caller who made it, as the runtime names them' }),
  at: Schema.String.annotate({ description: 'When it was made, in ISO 8601 UTC' }),
  open: Schema.Boolean.annotate({ description: 'true until it is resolved, and again once it is reopened' }),
  resolved_at: NullableText('When it was resolved, in ISO 8601 UTC; null while it is open'),
  resolved_by: NullableText('The id of the caller who resolved it; null while it is open'),
  resolved_how: Schema.NullOr(ResolvedHowSchema).annotate({
    description: 'acted, done as it asked, or dismissed, closed without acting; null while it is open',
  }),
  reopened_at: NullableText('When it was last reopened, in ISO 8601 UTC; null until it is reopened'),
  reopened_by: NullableText('The id of the caller who last reopened it; null until it is reopened'),
  studio: Schema.optionalKey(
    Schema.String.annotate({
      description: "The comment's place in Studio, which opens its address and shows the comment beside it",
    }),
  ),
}).annotate({
  identifier: 'Comment',
  description: 'A comment a person made on something of a playbook or the organization',
});

type ShownComment = typeof CommentSchema.Type;

type KeptComment = Omit<ShownComment, 'studio'>;

const CommentColumnsSchema = Schema.Struct({
  address: Schema.String,
  text: Schema.String,
  anchor_x: Schema.NullOr(Schema.Int),
  anchor_y: Schema.NullOr(Schema.Int),
  by: Schema.String,
  by_name: Schema.String,
  at: Schema.Int,
  open: Schema.Boolean,
  resolved_at: Schema.NullOr(Schema.Int),
  resolved_by: Schema.NullOr(Schema.String),
  resolved_how: Schema.NullOr(ResolvedHowSchema),
  reopened_at: Schema.NullOr(Schema.Int),
  reopened_by: Schema.NullOr(Schema.String),
});

const commentColumnsOf = Schema.decodeUnknownOption(CommentColumnsSchema);

function isoOf(time: number): string {
  return new Date(time).toISOString();
}

function isoOrNullOf(time: number | null): string | null {
  return time === null ? null : isoOf(time);
}

function resolvedOf(resolution: CommentState['resolution']) {
  return resolution === null
    ? { open: true, resolved_at: null, resolved_by: null, resolved_how: null }
    : { open: false, resolved_at: resolution.at, resolved_by: resolution.by, resolved_how: resolution.how };
}

function reopenedOf(reopening: CommentState['reopening']) {
  return { reopened_at: reopening?.at ?? null, reopened_by: reopening?.by ?? null };
}

export function keptOfState(
  id: string,
  { address, text, anchor, madeBy, at, resolution, reopening }: CommentState,
): KeptComment {
  return {
    id,
    address,
    text,
    anchor,
    by: madeBy.id,
    by_name: madeBy.name,
    at,
    ...resolvedOf(resolution),
    ...reopenedOf(reopening),
  };
}

type CommentColumns = typeof CommentColumnsSchema.Type;

function anchorOf({ anchor_x: x, anchor_y: y }: CommentColumns) {
  return x === null || y === null ? null : { x: fractionOf(x), y: fractionOf(y) };
}

function keptOfColumns(id: string, columns: CommentColumns): KeptComment {
  return {
    id,
    address: columns.address,
    text: columns.text,
    anchor: anchorOf(columns),
    by: columns.by,
    by_name: columns.by_name,
    at: isoOf(columns.at),
    open: columns.open,
    resolved_at: isoOrNullOf(columns.resolved_at),
    resolved_by: columns.resolved_by,
    resolved_how: columns.resolved_how,
    reopened_at: isoOrNullOf(columns.reopened_at),
    reopened_by: columns.reopened_by,
  };
}

export function keptOfRow({ key, row }: ProjectedKeyedRow): readonly KeptComment[] {
  return Option.toArray(commentColumnsOf(row)).map((columns) => keptOfColumns(key, columns));
}

type OnARun = Extract<CommentTarget, { kind: 'run' | 'event' | 'block' | 'request' }>;

type OfThePlaybook = Exclude<CommentTarget, OfTheOrg>;

function runPlaceOf(target: OnARun): CommentedPlace {
  if (target.kind === 'event') {
    return { kind: 'run', run: target.run, event: target.event };
  }
  return target.kind === 'block'
    ? { kind: 'run', run: target.run, block: target.block }
    : { kind: 'run', run: target.run };
}

function placeOf(target: OfThePlaybook): CommentedPlace {
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

const settingsOfThings: Readonly<Record<Exclude<OfTheOrg['kind'], 'org' | 'settings'>, string>> = {
  connection: 'connections',
  member: 'members',
};

function settingsOf(target: OfTheOrg): string | undefined {
  if (target.kind === 'org') {
    return undefined;
  }
  return target.kind === 'settings' ? target.page : settingsOfThings[target.kind];
}

function pageOf(id: string, target: CommentTarget): StudioPage {
  if ('playbook' in target) {
    return { kind: 'comment', playbook: target.playbook, comment: id, on: placeOf(target) };
  }
  const settings = settingsOf(target);
  return settings === undefined ? { kind: 'org_comment', comment: id } : { kind: 'org_comment', comment: id, settings };
}

export function shownComment(comment: KeptComment): Effect.Effect<ShownComment> {
  const target = commentTargetOf(comment.address);
  return target === undefined ? Effect.succeed(comment) : withStudioLink(comment, pageOf(comment.id, target));
}
