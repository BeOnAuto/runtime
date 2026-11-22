import type { KeptSecrets } from '@on.auto/openid-connect/authorization-server';
import { secretStoreOn } from '@on.auto/secrets';
import { memoryKeeper, memoryRows } from '@on.auto/secrets/testing';
import { DateTime, Effect } from 'effect';

import { chatStoreOver, type ChatStore } from '../../chat/store/chat-store.ts';
import type { ChatRows } from '../../chat/tables/chat-rows.ts';
import { keptSecretsOf } from '../../sign-in/issued-tokens.ts';
import { chatRowsInMemory } from './chat-rows-in-memory.ts';

interface SteppedClock {
  readonly now: () => Promise<number>;
  readonly moveTo: (at: number) => void;
}

function steppedClock(): SteppedClock {
  const state = { at: 0 };
  return {
    now: () => Promise.resolve(state.at),
    moveTo: (at) => {
      state.at = at;
    },
  };
}

interface CountedKeys extends KeptSecrets {
  readonly reads: () => number;
  readonly forgotten: () => number;
}

function countedKeys(): CountedKeys {
  const keeper = memoryKeeper();
  const keys = keptSecretsOf(
    secretStoreOn(memoryRows({ now: Effect.map(DateTime.now, DateTime.toEpochMillis) }), { current: keeper }),
  );
  const counted = { reads: 0 };
  return {
    ...keys,
    read: (id) => {
      counted.reads += 1;
      return keys.read(id);
    },
    reads: () => counted.reads,
    forgotten: () => keeper.released().length,
  };
}

export interface ChatStoreInMemory {
  readonly rows: ChatRows;
  readonly keys: CountedKeys;
  readonly clock: SteppedClock;
  readonly store: ChatStore;
}

export function chatStoreInMemory(leaseMs?: number, rows: ChatRows = chatRowsInMemory()): ChatStoreInMemory {
  const keys = countedKeys();
  const clock = steppedClock();
  const store = chatStoreOver(rows, keys, { now: clock.now, ...(leaseMs === undefined ? {} : { leaseMs }) });
  return { rows, keys, clock, store };
}
