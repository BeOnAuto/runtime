import { sha256Of, type ContentOwner, type ContentStore, type Digested, type RecordedContent } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import type { Context, Decider, Lineage, StreamWriter } from '@on.auto/operations';
import {
  PayloadErased,
  jsonPayloadText,
  payloadKept,
  textBytesOf,
  type PayloadReader,
} from '@on.auto/operations/payloads';
import { Effect, Result, type Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { RunEventSchema, type RecordedRunEvent, type RunEvent } from '../runs/run-events.ts';

interface FactsGiven {
  readonly events: readonly RunEvent[];
  readonly context: Context;
}

const factsAsGiven: Decider<undefined, FactsGiven, RecordedRunEvent> = {
  initialState: undefined,
  evolve: () => {},
  decide: ({ events }) => Result.succeed(events),
  context: ({ context }) => context,
  eventSchema: RunEventSchema,
};

export function recordedAsGiven(
  ledger: StreamWriter,
  stream: string,
  events: readonly RunEvent[],
  context: Context & { readonly runId: string },
): Effect.Effect<void> {
  const lineage: Lineage = { causationId: null, correlationId: context.runId };
  return Effect.orDie(Effect.asVoid(ledger.execute(stream, factsAsGiven, { events, context }, lineage)));
}

export function keptArmOf(value: Schema.Json): Digested {
  const { text } = jsonPayloadText(value);
  return { sha256: sha256Of(text), bytes: textBytesOf(text) };
}

export function keptIn(content: RecordedContent, owner: ContentOwner, value: Schema.Json): Effect.Effect<Digested> {
  const kept = keptArmOf(value);
  return Effect.as(Effect.orDie(payloadKept(content, owner, { ...kept, ...jsonPayloadText(value) })), kept);
}

const longBefore = Date.parse('2026-01-01T00:00:00.000Z');

export function keptLongBeforeAndLost(
  content: RecordedContent,
  store: Pick<ContentStore, 'delete'>,
  owner: ContentOwner,
  value: Schema.Json,
): Effect.Effect<Digested> {
  return TestClock.setTime(longBefore).pipe(
    Effect.andThen(keptIn(content, owner, value)),
    Effect.tap(({ sha256 }) => store.delete(owner, sha256)),
    Effect.provide(TestClock.layer()),
  );
}

export interface WatchedStore {
  readonly store: ContentStore;
  readonly reads: () => number;
  readonly fail: () => void;
  readonly failPuts: () => void;
  readonly lose: () => void;
}

const noAnswer = Effect.die(new Error('The bucket did not answer'));

export function watchedStore(): WatchedStore {
  const store = memoryContentStore();
  const watched = { reads: 0, failing: false, failingPuts: false, lost: false };
  const readOf: ContentStore['read'] = (owner, sha256) => {
    if (watched.failing) {
      return noAnswer;
    }
    return watched.lost ? Effect.undefined : store.read(owner, sha256);
  };
  return {
    store: {
      ...store,
      read: (owner, sha256) =>
        Effect.suspend(() => {
          watched.reads += 1;
          return readOf(owner, sha256);
        }),
      stage: (owner, content) => Effect.suspend(() => (watched.failingPuts ? noAnswer : store.stage(owner, content))),
    },
    reads: () => watched.reads,
    fail: () => {
      watched.failing = true;
    },
    failPuts: () => {
      watched.failingPuts = true;
    },
    lose: () => {
      watched.lost = true;
    },
  };
}

export function erasingReader({ org, playbook }: ContentOwner): PayloadReader {
  const erased = ({ sha256 }: Digested) =>
    Effect.fail(new PayloadErased({ org, playbook, sha256, message: `The payload kept under ${sha256} was erased` }));
  return { json: erased, text: erased, all: () => erased({ sha256: 'each', bytes: 0 }) };
}
