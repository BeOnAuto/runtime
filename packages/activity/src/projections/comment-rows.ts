import { recordedDecoder, type KeyedProjection, type ProjectedRow } from '@on.auto/operations';
import { Option } from 'effect';

import {
  CommentEventSchema,
  commentStreamKind,
  tenThousandthsOf,
  type Anchor,
  type RecordedCommentEvent,
} from '../facts/comment-facts.ts';
import { commentTargetOf, thingAddressOf, type CommentTarget } from '../positions/comment-addresses.ts';
import { millisecondsOf } from './activity-facts.ts';

export const commentsName = 'comments';

const commentFactOf = recordedDecoder(CommentEventSchema);

interface About {
  readonly about_run: string | null;
  readonly about_version: string | null;
  readonly about_definition: string | null;
}

const aboutNothing: About = { about_run: null, about_version: null, about_definition: null };

function aboutOf(target: CommentTarget): About {
  if (target.kind === 'definition' || target.kind === 'step') {
    const definition = `${target.type}/${target.name}`;
    return { ...aboutNothing, about_version: `${definition}/${target.version}`, about_definition: definition };
  }
  return target.kind === 'run' || target.kind === 'event' || target.kind === 'block'
    ? { ...aboutNothing, about_run: target.run }
    : aboutNothing;
}

function aboutAddress(address: string) {
  const target = commentTargetOf(address);
  return target === undefined
    ? { ...aboutNothing, about_thing: address }
    : { ...aboutOf(target), about_thing: thingAddressOf(target) };
}

function anchorColumnsOf(anchor: Anchor | undefined) {
  return anchor === undefined
    ? { anchor_x: null, anchor_y: null }
    : { anchor_x: tenThousandthsOf(anchor.x), anchor_y: tenThousandthsOf(anchor.y) };
}

function rowOfMade(fact: Extract<RecordedCommentEvent, { type: 'comment_made' }>): ProjectedRow {
  const { address, text, made_by: madeBy, anchor } = fact.data;
  const at = millisecondsOf(fact.context.at);
  return {
    address,
    text,
    ...anchorColumnsOf(anchor),
    by: madeBy.id,
    by_name: madeBy.name,
    at,
    open: true,
    resolved_at: null,
    resolved_by: null,
    resolved_how: null,
    reopened_at: null,
    reopened_by: null,
    listed_at: at,
    listed_by: madeBy.id,
    ...aboutAddress(address),
  };
}

function rowAfterFact(row: ProjectedRow | undefined, fact: RecordedCommentEvent): ProjectedRow | undefined {
  if (fact.type === 'comment_made') {
    return rowOfMade(fact);
  }
  const at = millisecondsOf(fact.context.at);
  const { by } = fact.context;
  if (fact.type === 'comment_resolved') {
    return row?.['open'] === true
      ? { ...row, open: false, resolved_at: at, resolved_by: by, resolved_how: fact.data.how }
      : undefined;
  }
  return row?.['open'] === false
    ? {
        ...row,
        open: true,
        resolved_at: null,
        resolved_by: null,
        resolved_how: null,
        reopened_at: at,
        reopened_by: by,
        listed_at: at,
        listed_by: by,
      }
    : undefined;
}

const keptInOrder = ['open', 'at', 'row_key'];

export const commentRows: KeyedProjection = {
  name: commentsName,
  version: 2,
  scopes: ['playbook', 'org'],
  kinds: [commentStreamKind],
  types: ['comment_made', 'comment_resolved', 'comment_reopened'],
  columns: [
    { name: 'address', kind: 'text' },
    { name: 'text', kind: 'text' },
    { name: 'anchor_x', kind: 'integer' },
    { name: 'anchor_y', kind: 'integer' },
    { name: 'by', kind: 'text' },
    { name: 'by_name', kind: 'text' },
    { name: 'at', kind: 'integer' },
    { name: 'open', kind: 'boolean' },
    { name: 'resolved_at', kind: 'integer' },
    { name: 'resolved_by', kind: 'text' },
    { name: 'resolved_how', kind: 'text' },
    { name: 'reopened_at', kind: 'integer' },
    { name: 'reopened_by', kind: 'text' },
    { name: 'listed_at', kind: 'integer' },
    { name: 'listed_by', kind: 'text' },
    { name: 'about_run', kind: 'text' },
    { name: 'about_version', kind: 'text' },
    { name: 'about_definition', kind: 'text' },
    { name: 'about_thing', kind: 'text' },
  ],
  indexes: [
    { name: 'open', columns: keptInOrder },
    { name: 'listed', columns: ['open', 'listed_at', 'row_key'] },
    { name: 'listed_by', columns: ['open', 'listed_by', 'listed_at', 'row_key'] },
    { name: 'address', columns: ['address', ...keptInOrder] },
    { name: 'about_run', columns: ['about_run', ...keptInOrder] },
    { name: 'about_version', columns: ['about_version', ...keptInOrder] },
    { name: 'about_definition', columns: ['about_definition', ...keptInOrder] },
    { name: 'about_thing', columns: ['about_thing', ...keptInOrder] },
  ],
  rowAfter: (row, message) =>
    Option.getOrUndefined(Option.map(commentFactOf(message), (fact) => rowAfterFact(row, fact))),
};
