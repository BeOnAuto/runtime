import {
  OrgReader,
  PagingOutputFields,
  PlaybookContext,
  PlaybookReader,
  cursorOfParts,
  defineQuery,
  partsOfCursor,
  type BoundProjectionReader,
  type InvalidInput,
  type PlainLanguage,
  type ProjectedCondition,
  type ProjectedKeyedRow,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { isPart, listedTargetOf, playbookOfTarget, type ListedTarget } from '../positions/comment-addresses.ts';
import {
  noPagesOfTheirOwn,
  pagesOfTheirOwn,
  pagesOfTheirOwnOf,
  type PagesOfTheirOwn,
} from '../positions/current-addresses.ts';
import { commentsName } from '../projections/comment-rows.ts';
import { AddressInputField, CursorField, LimitField, commentsInAPage, refusedAt } from './comment-fields.ts';
import { CommentSchema, keptOfRow, shownComment } from './comment-shown.ts';

const ListCommentsInputSchema = Schema.Struct({
  address: Schema.optionalKey(
    AddressInputField.annotate({
      description:
        'An address of a thing of the playbook, or of the organization for its own comments: keep the comments on it',
    }),
  ),
  under: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'true keeps the comments on address and on every address under it, such as the events of a run; it may then name a definition without its version',
    }),
  ),
  open: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'true keeps the open comments, false the resolved ones; true when left out',
    }),
  ),
  limit: Schema.optionalKey(LimitField),
  cursor: Schema.optionalKey(CursorField),
});

type ListCommentsInput = typeof ListCommentsInputSchema.Type;

const CursorSchema = Schema.Tuple([Schema.String, Schema.Int, Schema.String]);

function newestFirst(one: ProjectedKeyedRow, other: ProjectedKeyedRow): number {
  const byTime = Number(other.row['at']) - Number(one.row['at']);
  return byTime === 0 ? other.key.localeCompare(one.key) : byTime;
}

const isCursor = Schema.is(CursorSchema);

const ofTheOrg = '';

interface Owner {
  readonly playbook: string | undefined;
  readonly named: string;
  readonly pages: PagesOfTheirOwn;
}

function ownedBy(owner: Owner): string {
  return owner.playbook ?? ofTheOrg;
}

function afterOf(owner: Owner, cursor: string | undefined) {
  if (cursor === undefined) {
    return Effect.undefined;
  }
  const parts = Option.getOrUndefined(partsOfCursor(cursor));
  return isCursor(parts) && parts[0] === ownedBy(owner)
    ? Effect.succeed(parts.slice(1))
    : Effect.fail(refusedAt('/cursor', `Expected the next_cursor of a page of list_comments of ${owner.named}`));
}

function underOf(target: ListedTarget, address: string, pages: PagesOfTheirOwn): readonly ProjectedCondition[] {
  if (isPart(target)) {
    return [{ column: 'address', equals: address }];
  }
  if (target.kind === 'run') {
    return [{ column: 'about_run', equals: target.run }];
  }
  if (target.kind === 'definition') {
    return [{ column: 'about_version', equals: `${target.type}/${target.name}/${target.version}` }];
  }
  return target.kind === 'every_version'
    ? [`${target.type}/${target.name}`, ...pagesOfTheirOwnOf(pages, target.type, target.name)].map((definition) => ({
        column: 'about_definition',
        equals: definition,
      }))
    : [{ column: 'about_thing', equals: address }];
}

function addressedIn(
  owner: Owner,
  { address, under = false }: ListCommentsInput,
): Effect.Effect<readonly (readonly ProjectedCondition[])[], InvalidInput> {
  if (address === undefined) {
    return under
      ? Effect.fail(refusedAt('/under', 'Expected an address to list the comments under'))
      : Effect.succeed([[]]);
  }
  const target = listedTargetOf(address);
  if (
    target === undefined ||
    playbookOfTarget(target) !== owner.playbook ||
    (target.kind === 'every_version' && !under)
  ) {
    return Effect.fail(refusedAt('/address', `Expected the address of something of ${owner.named}`));
  }
  return Effect.succeed(
    under
      ? underOf(target, address, owner.pages).map((condition) => [condition])
      : [[{ column: 'address', equals: address }]],
  );
}

function listedWith(reader: BoundProjectionReader, owner: Owner, input: ListCommentsInput) {
  return Effect.gen(function* () {
    const wheres = yield* addressedIn(owner, input);
    const after = yield* afterOf(owner, input.cursor);
    const limit = input.limit ?? commentsInAPage;
    const read = yield* Effect.forEach(wheres, (where) =>
      reader.readProjectedRows(commentsName, {
        where: [{ column: 'open', equals: input.open ?? true }, ...where],
        orderBy: ['at'],
        order: 'desc',
        ...(after === undefined ? {} : { after }),
        limit: limit + 1,
      }),
    );
    const rows = read.flat().toSorted(newestFirst);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const hasMore = rows.length > limit && last !== undefined;
    return {
      comments: yield* Effect.forEach(
        page.flatMap((row) => keptOfRow(row)),
        (comment) => shownComment(comment, owner.pages),
      ),
      has_more: hasMore,
      next_cursor: hasMore ? cursorOfParts([ownedBy(owner), Number(last.row['at']), last.key]) : null,
    };
  });
}

const listed = Effect.fnUntraced(function* (input: ListCommentsInput) {
  const { playbook } = yield* PlaybookContext;
  const owner = { playbook, named: `the playbook ${playbook}`, pages: yield* pagesOfTheirOwn };
  return yield* listedWith(yield* PlaybookReader, owner, input);
});

const listedInOrg = Effect.fnUntraced(function* (input: ListCommentsInput) {
  const owner = { playbook: undefined, named: "the organization's own", pages: noPagesOfTheirOwn };
  return yield* listedWith(yield* OrgReader, owner, input);
});

function commentsInWords(count: number, open: boolean | undefined): string {
  const kept = open === false ? 'resolved' : 'open';
  if (count === 0) {
    return `No ${kept} comment is on this page.`;
  }
  return count === 1 ? `Found 1 ${kept} comment on this page.` : `Found ${count} ${kept} comments on this page.`;
}

const ListCommentsOutputSchema = Schema.Struct({
  comments: Schema.Array(CommentSchema).annotate({ description: 'The comments of the page, newest first' }),
  ...PagingOutputFields,
});

const listedInWords: PlainLanguage<ListCommentsInput, typeof ListCommentsOutputSchema.Type> = {
  task: 'list the comments',
  attempt: () => 'list the comments',
  outcome: ({ comments }, { open }) => commentsInWords(comments.length, open),
};

const keptAndClosed = [
  '`address` keeps the comments on one thing, and with `under` those on everything under it, such as the events of a run.',
];

export const listComments = defineQuery('playbook', {
  name: 'list_comments',
  title: 'List comments',
  description: [
    'Lists the comments people made in Studio on things of the playbook, newest first, the open ones unless `open` is false.',
    'Use it when the person says they left comments in Studio, or pastes comments copied from it: the open comments are what people said that nobody has acted on yet.',
    'Each names what it is about by its `address`, such as a step or a run, which get_definition or get_run reads and update_definition changes as the comment asks; a comment on an earlier version is read against the current document.',
    ...keptAndClosed,
    'Once a comment is acted on, resolve_comment closes it, and its `studio` is the place in Studio to give the person.',
  ].join(' '),
  route: { method: 'GET', path: '/comments' },
  inputSchema: ListCommentsInputSchema,
  outputSchema: ListCommentsOutputSchema,
  reasons: ['invalid_input'],
  handle: listed,
  plainLanguage: listedInWords,
});

export const listCommentsInOrg = defineQuery('org', {
  name: 'list_comments',
  title: 'List comments',
  description: [
    "Lists the comments people made in Studio, newest first, the open ones unless `open` is false: with `playbook`, that playbook's, and without it, the organization's own, on its connections, members, Settings or itself.",
    "Use it when the person says they left comments in Studio or pastes the line Studio copies; to act on all, read the organization's own and each playbook's.",
    'Each names what it is about by its `address`, which says which tool reads and changes the thing, such as get_definition for a step or list_connections for a connection.',
    ...keptAndClosed,
    'Once one is acted on, resolve_comment closes it, with the same `playbook` or none; its `studio` is its place in Studio to give the person.',
  ].join(' '),
  route: { method: 'GET', path: '/comments' },
  permittedBy: ['org:read', 'playbook:read'],
  inputSchema: ListCommentsInputSchema,
  outputSchema: ListCommentsOutputSchema,
  reasons: ['invalid_input'],
  handle: listedInOrg,
  plainLanguage: listedInWords,
});
