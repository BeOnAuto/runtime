import { Effect, Result, Schema } from 'effect';

import {
  ActedContextSchema,
  PlaybookReader,
  PlaybookWriter,
  defineCommand,
  defineQuery,
  factOf,
  type Decider,
} from '../index.ts';
import { testedContext } from './callers.ts';

const ItemSchema = Schema.Struct({ item: Schema.String });

type Item = typeof ItemSchema.Type;

const ItemShelvedSchema = factOf('item_shelved', ItemSchema, ActedContextSchema);

type ItemShelved = typeof ItemShelvedSchema.Type;

const shelf: Decider<readonly string[], Item, ItemShelved> = {
  initialState: [],
  evolve: (items, { data }) => [...items, data.item],
  decide: (item) => Result.succeed([{ type: 'item_shelved', data: item }]),
  context: () => testedContext,
  eventSchema: ItemShelvedSchema,
};

const Shelved = Schema.Struct({ items: Schema.Array(Schema.String) });

export const putOnShelf = defineCommand('playbook', {
  name: 'put_on_shelf',
  title: 'Put on shelf',
  description: 'Puts an item on the shelf the caller names.',
  route: { method: 'POST', path: '/shelves/{shelf}' },
  inputSchema: Schema.Struct({ shelf: Schema.String, item: Schema.String }),
  outputSchema: Shelved,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* ({ shelf: named, item }) {
    const { state } = yield* (yield* PlaybookWriter).execute(`shelves/${named}`, shelf, { item });
    return { items: state };
  }),
});

export const readShelf = defineQuery('playbook', {
  name: 'read_shelf',
  title: 'Read shelf',
  description: 'Lists the items on the shelf the caller names.',
  route: { method: 'GET', path: '/shelves/{shelf}' },
  inputSchema: Schema.Struct({ shelf: Schema.String }),
  outputSchema: Shelved,
  reasons: [],
  handle: Effect.fnUntraced(function* ({ shelf: named }) {
    const { state } = yield* (yield* PlaybookReader).load(`shelves/${named}`, shelf);
    return { items: state };
  }),
});
