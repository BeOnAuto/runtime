import {
  InvalidInput,
  NotFound,
  OrgContext,
  PagingInputFields,
  PagingOutputFields,
  counted,
  cursorOfParts,
  defaultPageLimit,
  defineQuery,
  partsOfCursor,
  quoted,
  type Noun,
} from '@on.auto/operations';
import { Effect, Option, Order, Schema } from 'effect';

import type { ToolAnnotations } from '../bounds/tool-results.ts';
import { unavailableServerOf } from '../tool-reads/tool-refusals.ts';
import type { ListingWays } from './listing-ways.ts';
import type { ServerTool } from './tool-server.ts';

const description = [
  "Lists the tools a connection's server offers now, those its entry allows, by name, a page at a time.",
  'Each has its title where the server gives one, its whole description and its hints: read_only, destructive, idempotent and open_world.',
  'Use it to show the person what one connection can do; search finds tools across servers.',
  '`cursor` is the next_cursor of the page before, to read on only as the person needs.',
].join(' ');

const hinted = (what: string) =>
  Schema.optionalKey(Schema.Boolean.annotate({ description: `Whether its server marks the tool ${what}` }));

const ConnectionToolSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The name of the tool, which a function writes after the slash' }),
  title: Schema.optionalKey(Schema.String.annotate({ description: 'What a person reads as its name' })),
  description: Schema.String.annotate({
    description: 'What the tool does, as its server describes it, cut to 4 KiB; empty when it gives none',
  }),
  read_only: hinted('read-only'),
  destructive: hinted('destructive, where it is not read-only'),
  idempotent: hinted('idempotent'),
  open_world: hinted('as reaching beyond its server'),
}).annotate({ description: 'A tool, with the hints its server gives it, each absent where it gives none' });

const ConnectionToolsSchema = Schema.Struct({
  connection: Schema.String.annotate({ description: 'The id of the connection, as given' }),
  server: Schema.String.annotate({
    description: 'The name of the connection, which a function writes before the slash',
  }),
  tools: Schema.Array(ConnectionToolSchema).annotate({ description: 'The tools of this page, by name' }),
  ...PagingOutputFields,
});

type ConnectionTool = typeof ConnectionToolSchema.Type;

const hintNames: readonly (readonly [
  keyof ToolAnnotations,
  'read_only' | 'destructive' | 'idempotent' | 'open_world',
])[] = [
  ['readOnlyHint', 'read_only'],
  ['destructiveHint', 'destructive'],
  ['idempotentHint', 'idempotent'],
  ['openWorldHint', 'open_world'],
];

function hintsOf({ annotations = {} }: ServerTool): Partial<Record<(typeof hintNames)[number][1], boolean>> {
  return Object.fromEntries(
    hintNames.flatMap(([hint, name]) => {
      const given = annotations[hint];
      return given === undefined ? [] : [[name, given]];
    }),
  );
}

function shownOf(tool: ServerTool): ConnectionTool {
  const { name, title, description: what } = tool;
  return { name, ...(title === undefined ? {} : { title }), description: what, ...hintsOf(tool) };
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

function listedInWords({ server, tools, has_more: hasMore }: typeof ConnectionToolsSchema.Type): string {
  const more = hasMore ? ', and more remain' : '';
  return `The connection ${quoted(server)} offers ${counted(tools.length, toolNoun)} on this page${more}.`;
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
      const remaining = server.tools.toSorted(byName).filter(({ name }) => after === undefined || name > after);
      const page = remaining.slice(0, limit);
      const last = page.at(-1);
      const hasMore = remaining.length > limit && last !== undefined;
      return {
        connection: id,
        server: server.name,
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
