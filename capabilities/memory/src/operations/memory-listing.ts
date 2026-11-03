import {
  Caller,
  InvalidInput,
  OrgContext,
  PagingInputFields,
  PlaybookContext,
  canAccessPlaybook,
  cursorOfParts,
  defaultPageLimit,
  defineHttpOperation,
  partsOfCursor,
  type ProjectedAddress,
  type ProjectedValue,
} from '@on.auto/operations';
import { loadRegistry } from '@on.auto/playbooks';
import { Effect, Option, Schema } from 'effect';

import { organizationKeeperOf, type MemoryPorts } from '../capability/memory-ports.ts';
import type { MemoryKeeper } from '../keeper/memory-keeper.ts';
import { memoryRowOf, type MemoryRow } from '../projection/memory-row-reading.ts';
import { newestFirst } from '../recall/memory-matching.ts';
import { MemoryListingSchema } from './memory-outputs.ts';

const ListingInputSchema = Schema.Struct({ limit: PagingInputFields.limit, cursor: PagingInputFields.cursor });

type Listing = typeof ListingInputSchema.Type;

const isCursor = Schema.is(Schema.Tuple([Schema.String, Schema.String]));

const badCursor = new InvalidInput({
  detail: 'The cursor is not one list_memories gave',
  issues: [{ pointer: '/cursor', detail: 'Expected the next_cursor of a page of list_memories' }],
});

function afterOf(cursor: string | undefined): Effect.Effect<readonly ProjectedValue[] | undefined, InvalidInput> {
  if (cursor === undefined) {
    return Effect.undefined;
  }
  const parts = Option.getOrUndefined(partsOfCursor(cursor));
  return isCursor(parts) ? Effect.succeed(parts) : Effect.fail(badCursor);
}

function listedOf(row: MemoryRow) {
  const { id, scope, playbook, status, version, text, tags, about, expiresAt, writtenAt, writtenBy } = row;
  return {
    id,
    scope,
    ...(playbook === undefined ? {} : { playbook }),
    status,
    version,
    text,
    tags,
    ...(about === undefined ? {} : { about }),
    expires_at: expiresAt,
    written_at: writtenAt,
    written_by: writtenBy,
  };
}

interface KeptAt {
  readonly keeper: MemoryKeeper;
  readonly address: ProjectedAddress;
}

const pageAcross = Effect.fnUntraced(function* (
  places: readonly KeptAt[],
  { limit = defaultPageLimit, cursor }: Listing,
) {
  const after = yield* afterOf(cursor);
  const query = { where: [], orderBy: ['written_at'], order: 'desc', limit: limit + 1 } as const;
  const asked = after === undefined ? query : { ...query, after };
  const read = yield* Effect.forEach(places, ({ keeper, address }) => keeper.rowsRead(address, asked));
  const rows = read
    .flat()
    .map((row) => memoryRowOf(row))
    .toSorted(newestFirst);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return {
    memories: page.map((row) => listedOf(row)),
    has_more: hasMore,
    next_cursor: hasMore ? cursorOfParts([last.writtenAt, last.id]) : null,
  };
});

export function defineListMemories(ports: MemoryPorts) {
  return defineHttpOperation('playbook', 'query', {
    name: 'list_memories',
    title: 'List the memories of a playbook',
    description:
      "Lists the memories the playbook recalls from, its own and its organization's, newest first, with what became of each: kept, forgotten, erased or moved.",
    route: { method: 'GET', path: '/memories' },
    body: { kind: 'none' },
    inputSchema: ListingInputSchema,
    outputSchema: MemoryListingSchema,
    reasons: ['invalid_input'],
    handle: Effect.fnUntraced(function* (listing: Listing) {
      const { org, playbook } = yield* PlaybookContext;
      const ofThePlaybook = { keeper: ports.kept, address: { org, playbook } };
      return yield* pageAcross([ofThePlaybook, { keeper: organizationKeeperOf(ports), address: { org } }], listing);
    }),
  });
}

export function defineListOrgMemories(ports: MemoryPorts) {
  return defineHttpOperation('org', 'query', {
    name: 'list_org_memories',
    title: 'List the memories of an organization',
    description:
      'Lists the memories of the organization and of each of its playbooks the caller may read, newest first, with the playbook that keeps each and what became of it: kept, forgotten, erased or moved.',
    route: { method: 'GET', path: '/memories' },
    body: { kind: 'none' },
    inputSchema: ListingInputSchema,
    outputSchema: MemoryListingSchema,
    reasons: ['invalid_input'],
    handle: Effect.fnUntraced(function* (listing: Listing) {
      const { org } = yield* OrgContext;
      const caller = yield* Caller;
      const playbooks = [...(yield* loadRegistry).keys()].filter((playbook) =>
        canAccessPlaybook(caller.playbooks, playbook),
      );
      const ofThePlaybooks = playbooks.map((playbook) => ({ keeper: ports.kept, address: { org, playbook } }));
      return yield* pageAcross([{ keeper: organizationKeeperOf(ports), address: { org } }, ...ofThePlaybooks], listing);
    }),
  });
}
