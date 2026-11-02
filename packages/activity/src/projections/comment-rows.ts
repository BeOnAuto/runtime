import { recordedDecoder, type KeyedProjection, type ProjectedRow } from '@on.auto/operations';
import { Option } from 'effect';

import { CommentEventSchema, commentStreamKind, type RecordedCommentEvent } from '../facts/comment-facts.ts';
import { commentTargetOf, type CommentTarget } from '../positions/comment-addresses.ts';
import { millisecondsOf } from './activity-facts.ts';

export const commentsName = 'comments';

const commentFactOf = recordedDecoder(CommentEventSchema);

interface About {
  readonly about_run: string | null;
  readonly about_version: string | null;
  readonly about_definition: string | null;
}

const aboutNothing: About = { about_run: null, about_version: null, about_definition: null };

function aboutOf(target: CommentTarget | undefined): About {
  if (target === undefined || target.kind === 'playbook' || target.kind === 'request') {
    return aboutNothing;
  }
  if (target.kind === 'definition' || target.kind === 'step') {
    const definition = `${target.type}/${target.name}`;
    return { ...aboutNothing, about_version: `${definition}/${target.version}`, about_definition: definition };
  }
  return { ...aboutNothing, about_run: target.run };
}

function rowAfterFact(row: ProjectedRow | undefined, fact: RecordedCommentEvent): ProjectedRow | undefined {
  if (fact.type === 'comment_made') {
    const { address, text, made_by: madeBy } = fact.data;
    return {
      address,
      text,
      by: madeBy.id,
      by_name: madeBy.name,
      at: millisecondsOf(fact.context.at),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      ...aboutOf(commentTargetOf(address)),
    };
  }
  return row?.['open'] === true
    ? {
        ...row,
        open: false,
        resolved_at: millisecondsOf(fact.context.at),
        resolved_by: fact.context.by,
        resolved_how: fact.data.how,
      }
    : undefined;
}

const keptInOrder = ['open', 'at', 'row_key'];

export const commentRows: KeyedProjection = {
  name: commentsName,
  version: 1,
  kinds: [commentStreamKind],
  types: ['comment_made', 'comment_resolved'],
  columns: [
    { name: 'address', kind: 'text' },
    { name: 'text', kind: 'text' },
    { name: 'by', kind: 'text' },
    { name: 'by_name', kind: 'text' },
    { name: 'at', kind: 'integer' },
    { name: 'open', kind: 'boolean' },
    { name: 'resolved_at', kind: 'integer' },
    { name: 'resolved_by', kind: 'text' },
    { name: 'resolved_how', kind: 'text' },
    { name: 'about_run', kind: 'text' },
    { name: 'about_version', kind: 'text' },
    { name: 'about_definition', kind: 'text' },
  ],
  indexes: [
    { name: 'open', columns: keptInOrder },
    { name: 'open_by', columns: ['open', 'by', 'at', 'row_key'] },
    { name: 'address', columns: ['address', ...keptInOrder] },
    { name: 'about_run', columns: ['about_run', ...keptInOrder] },
    { name: 'about_version', columns: ['about_version', ...keptInOrder] },
    { name: 'about_definition', columns: ['about_definition', ...keptInOrder] },
  ],
  rowAfter: (row, message) =>
    Option.getOrUndefined(Option.map(commentFactOf(message), (fact) => rowAfterFact(row, fact))),
};
