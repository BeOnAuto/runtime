import { changeKindOf, makeDispatcher, type PlacedFact, type Presenter } from '@on.auto/operations';
import { Effect, Fiber, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { defineListPlaybookChanges } from '../changes/list-changes.ts';
import { acmeAdmin } from './callers.ts';
import { asQueryString } from './harness.ts';
import { playbookFeed, presenterOf, recorder, toAlpha, type Fact } from './playbook-feed.ts';

const runChanged = changeKindOf('run', 'A run that moved', { run_id: 'The id of the run' });

function runOf({ stream }: PlacedFact) {
  return [runChanged.of({ run_id: stream.slice('runs/'.length) })];
}

const runs: Presenter = {
  ...presenterOf('runs', { added: 'run_moved', hidden: null }),
  changes: { kinds: [runChanged], named: { added: runOf, hidden: null } },
};

const pairChanged = changeKindOf('pair', 'A pair that moved', { pair: 'The id of the pair' });

const pairs: Presenter = {
  ...presenterOf('pairs', { added: 'pair_moved' }),
  changes: {
    kinds: [runChanged, pairChanged],
    named: {
      added: ({ stream }) => {
        const id = stream.slice('pairs/'.length);
        return [runChanged.of({ run_id: id }), pairChanged.of({ pair: id }), runChanged.of({ run_id: id })];
      },
    },
  },
};

export const listPlaybookChanges = defineListPlaybookChanges([
  runs,
  pairs,
  presenterOf('notes', { added: 'note_added' }),
]);

const ChangesSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({
    cursor: Schema.String,
    changes: Schema.Array(Schema.Record(Schema.String, Schema.String)),
    more: Schema.Boolean,
  }),
});

export const changesOf = (outcome: unknown) => Schema.decodeUnknownSync(ChangesSchema)(outcome).output;

export function followedPlaybook() {
  const feed = playbookFeed();
  const dispatcher = makeDispatcher([]);
  const asked = (input: object) =>
    dispatcher.dispatchToPlaybook(listPlaybookChanges.registration, asQueryString(toAlpha(acmeAdmin, input)));
  const changes = (input: object = {}) => feed.run(asked(input));
  const runRecorded = (run: string, type: Fact['type'] = 'added') =>
    Effect.orDie(
      feed.ledger.service.execute(`playbook/acme/alpha/runs/${run}`, recorder, {
        fact: { type, data: { text: run } },
        at: '2026-10-01T09:00:00.000Z',
      }),
    );
  const heldWhile = (input: object, meanwhile: Effect.Effect<unknown>) =>
    feed.run(
      Effect.gen(function* () {
        const held = yield* Effect.forkChild(asked(input));
        yield* meanwhile;
        return yield* Fiber.join(held);
      }),
    );
  return {
    ...feed,
    changes,
    runRecorded,
    heldWhile,
    waited: (seconds: number) => TestClock.adjust(`${seconds} seconds`),
  };
}
