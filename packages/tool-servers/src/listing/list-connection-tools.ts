import {
  InvalidInput,
  NotFound,
  OrgContext,
  PagingInputFields,
  PagingOutputFields,
  cursorOfParts,
  defaultPageLimit,
  defineQuery,
  partsOfCursor,
} from '@on.auto/operations';
import { counted, quoted, type Noun } from '@on.auto/phrasing';
import { Effect, Option, Order, Schema, Struct } from 'effect';

import { refusedOutsideTheListing } from '../access/directory-listing.ts';
import { MarkedBySchema, marksMeant, ToolAnnotationsSchema, ToolMarkSchema } from '../bounds/tool-results.ts';
import { unavailableOf, unavailableServerOf } from '../tool-reads/tool-refusals.ts';
import { cardsDescription, cardsFieldOf, rendersDescription } from './card-words.ts';
import type { ListingWays } from './listing-ways.ts';
import type { ServerTool } from './tool-server.ts';

const description = [
  "Lists the tools a connection's server offers now, those its entry allows, by name, a page at a time.",
  'Each has its title where the server gives one, its whole description, its hints and its mark.',
  'Use it to show the person what one connection can do; search finds tools across servers.',
  '`cursor` is the next_cursor of the page before.',
].join(' ');

const HintsSchema = Schema.Struct(Struct.omit(ToolAnnotationsSchema.fields, ['readOnlyHint'])).annotate({
  description:
    'The hints its server gives the tool, destructiveHint, idempotentHint and openWorldHint, as it gives them; absent when it gives none. Whether it only reads is its mark',
});

const ConnectionToolSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The name of the tool, which a function writes after the slash' }),
  title: Schema.optionalKey(Schema.String.annotate({ description: 'What a person reads as its name' })),
  description: Schema.String.annotate({
    description: 'What the tool does, as its server describes it, cut to 4 KiB; empty when it gives none',
  }),
  hints: Schema.optionalKey(HintsSchema),
  mark: ToolMarkSchema.annotate({ description: `The mark of the tool: ${marksMeant}` }),
  marked_by: MarkedBySchema,
}).annotate({
  description: 'A tool, with the hints its server gives it and its mark',
});

const ConnectionToolsSchema = Schema.Struct({
  connection: Schema.String.annotate({ description: 'The id of the connection, as given' }),
  server: Schema.String.annotate({
    description: 'The name of the connection, which a function writes before the slash',
  }),
  renders: Schema.optionalKey(Schema.String.annotate({ description: rendersDescription })),
  cards: Schema.optionalKey(Schema.String.annotate({ description: cardsDescription })),
  tools: Schema.Array(ConnectionToolSchema).annotate({ description: 'The tools of this page, by name' }),
  ...PagingOutputFields,
});

type ConnectionTool = typeof ConnectionToolSchema.Type;

function hintsOf({ annotations = {} }: ServerTool): Pick<ConnectionTool, 'hints'> {
  const hints = Struct.omit(annotations, ['readOnlyHint']);
  return Object.keys(hints).length === 0 ? {} : { hints };
}

function shownOf(tool: ServerTool): ConnectionTool {
  const { name, title, description: what, mark, marked_by: markedBy } = tool;
  return {
    name,
    ...(title === undefined ? {} : { title }),
    description: what,
    ...hintsOf(tool),
    mark,
    marked_by: markedBy,
  };
}

const byName = Order.mapInput(Order.String, ({ name }: ServerTool) => name);

const CursorSchema = Schema.Tuple([Schema.String]);

const isCursor = Schema.is(CursorSchema);

const badCursor = new InvalidInput({
  detail: 'The cursor is not one list_connection_tools gave',
  issues: [{ pointer: '/cursor', detail: 'Expected the next_cursor of a page of list_connection_tools' }],
});

function afterOf(cursor: string | undefined): Effect.Effect<string | undefined, InvalidInput> {
  if (cursor === undefined) {
    return Effect.undefined;
  }
  const parts = Option.getOrUndefined(partsOfCursor(cursor));
  return isCursor(parts) ? Effect.succeed(parts[0]) : Effect.fail(badCursor);
}

function connectionNotFound(id: string): NotFound {
  return new NotFound({ detail: `There is no connection ${id} in this org that is not removed` });
}

const toolNoun: Noun = { one: 'tool', other: 'tools' };

function listedInWords({ server, tools, has_more: hasMore, cards }: typeof ConnectionToolsSchema.Type): string {
  const more = hasMore ? ', and more remain' : '';
  const offered = `The connection ${quoted(server)} offers ${counted(tools.length, toolNoun)} on this page${more}.`;
  return cards === undefined ? offered : `${offered} ${cards}`;
}

export function defineListConnectionTools(tools: Pick<ListingWays, 'listConnection'>) {
  return defineQuery('org', {
    name: 'list_connection_tools',
    title: 'List the tools of a connection',
    description,
    route: { method: 'GET', path: '/connections/{id}/tools' },
    reachesOutside: true,
    inputSchema: Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The id of the connection' }),
      limit: PagingInputFields.limit,
      cursor: PagingInputFields.cursor,
    }),
    outputSchema: ConnectionToolsSchema,
    reasons: ['invalid_input', 'not_found', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, limit = defaultPageLimit, cursor }) {
      const after = yield* afterOf(cursor);
      const { org } = yield* OrgContext;
      const server = yield* tools.listConnection(org, id);
      if (server === undefined) {
        return yield* Effect.fail(connectionNotFound(id));
      }
      if ('unavailable' in server) {
        return yield* Effect.fail(unavailableServerOf(server));
      }
      yield* Effect.mapError(refusedOutsideTheListing(server.name, server), unavailableOf);
      const remaining = server.tools.toSorted(byName).filter(({ name }) => after === undefined || name > after);
      const page = remaining.slice(0, limit);
      const last = page.at(-1);
      const hasMore = remaining.length > limit && last !== undefined;
      return {
        connection: id,
        server: server.name,
        ...(server.renders === undefined ? {} : { renders: server.renders }),
        ...cardsFieldOf(server.name, server.renders),
        tools: page.map((tool) => shownOf(tool)),
        has_more: hasMore,
        next_cursor: hasMore ? cursorOfParts([last.name]) : null,
      };
    }),
    plainLanguage: {
      task: 'list the tools of a connection',
      attempt: () => 'list the tools of the connection',
      outcome: (listed) => listedInWords(listed),
    },
  });
}
