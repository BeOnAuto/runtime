import { PlaybookRegistry, type PlaybookStatus, type ProjectedRow } from '@on.auto/operations';
import type { Consumer, DueWork } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import { noReads } from '../assessor/assessor-fixtures.ts';
import { bookOf, deliveredAll, finished, sales, salesKey, type Book } from '../assessor/assessor-ledger.ts';
import { assessorOf } from '../assessor/assessor.ts';
import { opened } from '../conditions/condition-samples.ts';
import type { Instant } from '../goal-rules/goal-rule.ts';
import type { ClockPorts } from './clock-judging.ts';
import { goalsClockOf } from './goals-clock.ts';

interface Wake {
  readonly at: Instant;
  readonly performs: number;
}

export interface ClockHarness {
  readonly book: Book;
  readonly clock: DueWork;
  readonly assessor: Consumer;
  readonly wakes: readonly Wake[];
  readonly now: () => Instant;
  readonly movedTo: (at: Instant) => void;
  readonly goalsSaved: (goals: Schema.Json, at: string, version?: number) => Promise<void>;
  readonly paused: (workflow: string, at: string) => Promise<void>;
  readonly statusIs: (status: PlaybookStatus) => void;
  readonly observed: (id: string, output: Schema.Json, at: string, workflow?: string) => Promise<readonly string[]>;
  readonly performedAt: (at: Instant) => Promise<number>;
  readonly until: (at: string) => Promise<void>;
  readonly row: (table: string, key: string) => Promise<ProjectedRow | undefined>;
  readonly rebuilt: () => Promise<ClockHarness>;
}

type ClockOf = (ports: ClockPorts) => DueWork;

interface Moment {
  readonly now: () => Instant;
  readonly movedTo: (at: Instant) => void;
  readonly status: () => PlaybookStatus;
  readonly statusIs: (status: PlaybookStatus) => void;
}

interface Driven {
  readonly clock: DueWork;
  readonly moment: Moment;
  readonly wakes: readonly Wake[];
  readonly woke: (wake: Wake) => void;
}

function momentOf(start: string): Moment {
  const held: { now: Instant; status: PlaybookStatus } = { now: Date.parse(start), status: 'active' };
  return {
    now: () => held.now,
    movedTo: (at) => {
      held.now = at;
    },
    status: () => held.status,
    statusIs: (status) => {
      held.status = status;
    },
  };
}

const filters = opened().sandbox;

const jsonOf = Schema.decodeUnknownSync(Schema.Json);

function stamped(at: Instant): string {
  return new Date(at).toISOString();
}

function performedAt({ clock, moment, woke }: Driven, at: Instant) {
  return Effect.gen(function* () {
    moment.movedTo(Math.max(moment.now(), at));
    const items = yield* clock.due(at, 256, false);
    for (const item of items) {
      yield* item.perform(at);
    }
    const left = yield* clock.due(at, 256, false);
    if (left.length > 0) {
      return yield* Effect.die(new Error(`Rows left due at ${stamped(at)}: ${left.map(({ key }) => key).join(', ')}`));
    }
    if (items.length > 0) {
      woke({ at, performs: items.length });
    }
    return items.length;
  });
}

function performedUntil(driven: Driven, end: Instant) {
  return Effect.gen(function* () {
    yield* performedAt(driven, driven.moment.now());
    for (;;) {
      const next = yield* driven.clock.nextDueAt(driven.moment.now());
      if (next === null || next > end) {
        driven.moment.movedTo(Math.max(driven.moment.now(), end));
        return;
      }
      yield* performedAt(driven, next);
    }
  });
}

function replayedInto(fresh: Book, book: Book) {
  return Effect.gen(function* () {
    const { records } = yield* book.ledger.readRecorded(sales, { kind: 'everything' }, { order: 'asc', limit: 10_000 });
    for (const fact of records) {
      yield* Effect.promise(() =>
        fresh.append(fact.stream.slice(salesKey.length), fact.type, jsonOf(fact.data), fact.context),
      );
    }
  });
}

function pausedIn(book: Book, workflow: string, at: string): Promise<void> {
  return book.append(
    'definitions/workflow',
    'definition_paused',
    { paused_by: { id: 'person:owner', name: 'Owner' } },
    { at, definitionType: 'workflow', definitionName: workflow, definitionVersion: 1 },
  );
}

function drivenOf(start: string, book: Book, clockOf: ClockOf): Driven {
  const moment = momentOf(start);
  const registry = PlaybookRegistry.of({ status: () => Effect.sync(() => moment.status()) });
  const wakes: Wake[] = [];
  return {
    clock: clockOf({ ledger: book.ledger, registry }),
    moment,
    wakes,
    woke: (wake) => {
      wakes.push(wake);
    },
  };
}

function assessorOver(book: Book, moment: Moment): Consumer {
  return assessorOf({
    ledger: book.ledger,
    chainsOf: () => noReads,
    callers: { serviceCallers: new Set() },
    filters,
    now: moment.now,
  });
}

export function clockHarnessOf(start: string, book: Book = bookOf(), clockOf: ClockOf = goalsClockOf): ClockHarness {
  const driven = drivenOf(start, book, clockOf);
  const { moment } = driven;
  const assessor = assessorOver(book, moment);
  const until = (at: string) => Effect.runPromise(performedUntil(driven, Date.parse(at)));
  return {
    book,
    clock: driven.clock,
    assessor,
    wakes: driven.wakes,
    now: moment.now,
    movedTo: moment.movedTo,
    goalsSaved: async (goals, at, version = 1) => {
      await until(at);
      await book.append('goals/playbook', 'playbook_goals_saved', { source: 'goals', goals, version }, { at });
      await Effect.runPromise(performedAt(driven, Date.parse(at)));
    },
    paused: async (workflow, at) => {
      await until(at);
      await pausedIn(book, workflow, at);
    },
    statusIs: moment.statusIs,
    observed: async (id, output, at, workflow = 'check') => {
      await until(at);
      const { failed } = await deliveredAll(assessor, finished({ id, workflow, at: Date.parse(at), data: { output } }));
      return failed;
    },
    performedAt: (at) => Effect.runPromise(performedAt(driven, at)),
    until,
    row: async (table, key) => (await book.rows(table))[key],
    rebuilt: async () => {
      const fresh = bookOf();
      await Effect.runPromise(replayedInto(fresh, book));
      const again = clockHarnessOf(stamped(moment.now()), fresh, clockOf);
      again.statusIs(moment.status());
      return again;
    },
  };
}
