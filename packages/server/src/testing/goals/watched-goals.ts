import { DatabaseSync } from 'node:sqlite';

import type { GoalsPorts } from '@on.auto/goals';
import type { Ledger, ProjectedRow } from '@on.auto/operations';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import type { TemporaryLedger } from '../records/temporary-ledger.ts';
import type { ReasoningServer } from '../servers/reasoning-server.ts';
import { servingReasoning } from '../servers/reasoning-server.ts';
import {
  fewSweeps,
  steppedServerClock,
  testServersStartAt,
  type SteppedServerClock,
} from '../waiting/stepped-server-clock.ts';
import { goalIdentityIn } from './goal-identities.ts';

interface GoalsWatch {
  readonly asked: readonly string[];
  readonly sessions: () => number;
  readonly evaluations: () => number;
  readonly over: (ports: GoalsPorts) => GoalsPorts;
  readonly ports: Promise<GoalsPorts>;
}

function ledgerWatched(ledger: Ledger['Service'], told: (asked: string) => void): Ledger['Service'] {
  return {
    ...ledger,
    load: (stream, fold) => {
      told(`load ${stream}`);
      return ledger.load(stream, fold);
    },
    execute: (stream, decider, command, lineage) => {
      told(`execute ${stream}`);
      return ledger.execute(stream, decider, command, lineage).pipe(
        Effect.tapCause(() =>
          Effect.sync(() => {
            told(`failed ${stream}`);
          }),
        ),
      );
    },
    readProjectedRows: (projection, address, query) => {
      told(`rows ${projection} ${Object.values(address).join('/')}`);
      return ledger.readProjectedRows(projection, address, query);
    },
    countProjectedRows: (projection, address, where) => {
      told(`count ${projection} ${Object.values(address).join('/')}`);
      return ledger.countProjectedRows(projection, address, where);
    },
    readRecorded: (playbook, selection, page) => {
      told(`recorded ${playbook.playbook}`);
      return ledger.readRecorded(playbook, selection, page);
    },
    readRecordedEvent: (playbook, id) => {
      told(`recorded event ${playbook.playbook}`);
      return ledger.readRecordedEvent(playbook, id);
    },
    content: {
      ...ledger.content,
      get: (owner, sha256) => {
        told(`content ${owner.playbook}`);
        return ledger.content.get(owner, sha256);
      },
      getHead: (owner, sha256) => {
        told(`content head ${owner.playbook}`);
        return ledger.content.getHead(owner, sha256);
      },
    },
  };
}

function databaseWatched(database: GoalsPorts['database'], told: (asked: string) => void): GoalsPorts['database'] {
  const { store } = database;
  return {
    ...database,
    store: {
      ...store,
      readRecorded: (playbookKey, selection, page) => {
        told(`chain ${playbookKey}`);
        return store.readRecorded(playbookKey, selection, page);
      },
      readRecordedEvent: (playbookKey, id) => {
        told(`chain event ${playbookKey}`);
        return store.readRecordedEvent(playbookKey, id);
      },
    },
  };
}

interface Counting {
  readonly session: () => void;
  readonly evaluation: () => void;
}

function filtersWatched(filters: FilterSandbox, counting: Counting): FilterSandbox {
  return {
    ...filters,
    session: async (opening) => {
      counting.session();
      const session = await filters.session(opening);
      return {
        ...session,
        define: (source) => {
          const test = session.define(source);
          return (input, budget) => {
            counting.evaluation();
            return test(input, budget);
          };
        },
      };
    },
  };
}

function goalsWatch(): GoalsWatch {
  const asked: string[] = [];
  const counts = { sessions: 0, evaluations: 0 };
  const watched = Promise.withResolvers<GoalsPorts>();
  const told = (one: string) => {
    asked.push(one);
  };
  return {
    asked,
    sessions: () => counts.sessions,
    evaluations: () => counts.evaluations,
    over: (ports) => {
      const over: GoalsPorts = {
        ...ports,
        ledger: ledgerWatched(ports.ledger, told),
        database: databaseWatched(ports.database, told),
        filters: filtersWatched(ports.filters, {
          session: () => {
            counts.sessions += 1;
          },
          evaluation: () => {
            counts.evaluations += 1;
          },
        }),
      };
      watched.resolve(over);
      return over;
    },
    ports: watched.promise,
  };
}

export interface WatchedServer {
  readonly server: ReasoningServer;
  readonly clock: SteppedServerClock;
  readonly watch: GoalsWatch;
  readonly assessmentRows: (goal?: string) => Promise<readonly ProjectedRow[]>;
  readonly goalOf: (name: string) => Promise<string>;
}

export type GoalsPortsTurned = (ports: GoalsPorts) => GoalsPorts;

const asTheyAre: GoalsPortsTurned = (ports) => ports;

export async function servedWatched(
  ledger: TemporaryLedger,
  startsAt = testServersStartAt,
  turned: GoalsPortsTurned = asTheyAre,
): Promise<WatchedServer> {
  const watch = goalsWatch();
  const clock = steppedServerClock(startsAt);
  const composed = Promise.withResolvers<Ledger['Service']>();
  const server = await servingReasoning([], {}, undefined, {
    ledger,
    clock,
    goals: true,
    goalsResults: true,
    goalsMessages: true,
    goalsPortsOver: (ports) => watch.over(turned(ports)),
    ledgerOver: (kept) => {
      composed.resolve(kept);
      return kept;
    },
  });
  return {
    server,
    clock,
    watch,
    assessmentRows: async (goal) => {
      const kept = await composed.promise;
      const address =
        goal === undefined
          ? { org: 'acme', playbook: 'alpha' }
          : { org: 'acme', definition: await Effect.runPromise(goalIdentityIn(kept, goal)) };
      const rows = await Effect.runPromise(
        kept.readProjectedRows('goal_assessments', address, { where: [], orderBy: [], order: 'asc', limit: 1000 }),
      );
      return rows.map(({ row }) => row);
    },
    goalOf: async (name) => Effect.runPromise(goalIdentityIn(await composed.promise, name)),
  };
}

const aMinuteAndASecond = 61_000;

/** The value once it holds, the clock moved on a minute at a time while the server is at rest and it does not. */
export function movingUntil<A>(
  watched: Pick<WatchedServer, 'clock'>,
  read: () => A | Promise<A>,
  holds: (value: A) => boolean,
): Promise<A> {
  return watched.clock.steppedEvery(aMinuteAndASecond).until(read, holds, fewSweeps);
}

export function rowsHolding(
  watched: WatchedServer,
  holds: (rows: readonly ProjectedRow[]) => boolean,
  goal?: string,
): Promise<readonly ProjectedRow[]> {
  return movingUntil(watched, () => watched.assessmentRows(goal), holds);
}

export interface GoalFact {
  readonly stream: string;
  readonly type: string;
  readonly id: string;
  readonly data: unknown;
}

const StoredFact = Schema.Struct({
  stream_id: Schema.String,
  message_type: Schema.String,
  message_id: Schema.String,
  message_data: Schema.String,
});

const DataOf = Schema.fromJsonString(Schema.Unknown);

export function goalFactsIn(ledger: TemporaryLedger): readonly GoalFact[] {
  const database = new DatabaseSync(ledger.fileName, { readOnly: true });
  try {
    const rows = database
      .prepare(
        "SELECT stream_id, message_type, message_id, message_data FROM emt_messages WHERE message_type LIKE 'goal\\_%' ESCAPE '\\' ORDER BY global_position",
      )
      .all();
    return rows.map((row: unknown) => {
      const stored = Schema.decodeUnknownSync(StoredFact)(row);
      return {
        stream: stored.stream_id,
        type: stored.message_type,
        id: stored.message_id,
        data: Schema.decodeUnknownSync(DataOf)(stored.message_data),
      };
    });
  } finally {
    database.close();
  }
}

export function followerRewound(ledger: TemporaryLedger): void {
  const database = new DatabaseSync(ledger.fileName);
  try {
    database
      .prepare('UPDATE workflow_followed_orgs SET cursor = NULL, delivered = NULL, attempts = 0, waiting = 1')
      .run();
  } finally {
    database.close();
  }
}
