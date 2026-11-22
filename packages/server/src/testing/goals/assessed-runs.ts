import type { Ledger, ProjectedRow } from '@on.auto/operations';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import type { TemporaryLedger } from '../records/temporary-ledger.ts';
import { alpha, type ReasoningServer } from '../servers/reasoning-server.ts';
import { patientThreadPool } from '../servers/worker-pools.ts';
import { workflowSource } from '../servers/workflow-server.ts';
import { createdWithGoals, servingReasoningWithGoals } from '../settings/goals-kept.ts';
import { fewSweeps, testServersStartAt } from '../waiting/stepped-server-clock.ts';
import { wokenClock, type WokenClock } from './woken-clock.ts';

const aMinuteAndASecond = 61_000;

interface Watched {
  readonly tests: () => number;
}

export interface Assessing {
  readonly server: ReasoningServer;
  readonly clock: WokenClock;
  readonly asked: readonly string[];
  readonly watched: Watched;
  readonly rowsOf: (table: string, playbook?: string) => Promise<Readonly<Record<string, ProjectedRow>>>;
  readonly ledger: () => Promise<Ledger['Service']>;
  readonly ranAMinuteOn: () => void;
}

export interface Serving {
  readonly ledger: TemporaryLedger;
  readonly goals: string;
  readonly watching?: string;
  readonly results?: boolean;
  readonly messages?: boolean;
}

interface Watching {
  readonly source: string;
  readonly tested: () => void;
}

function watchedOver(filters: FilterSandbox, { source: watched, tested }: Watching): FilterSandbox {
  return {
    ...filters,
    session: async (opening) => {
      const session = await filters.session(opening);
      return {
        ...session,
        define: (source) => {
          const test = session.define(source);
          return source.trim() === watched
            ? (input, budget) => {
                tested();
                return test(input, budget);
              }
            : test;
        },
      };
    },
  };
}

function countedOver(ledger: Ledger['Service'], told: (asked: string) => void): Ledger['Service'] {
  return {
    ...ledger,
    load: (stream, fold) => {
      told(`load ${stream}`);
      return ledger.load(stream, fold);
    },
    execute: (stream, decider, command, lineage) => {
      told(`execute ${stream}`);
      return ledger.execute(stream, decider, command, lineage);
    },
    readProjectedRows: (projection, address, query) => {
      told(`rows ${projection} ${Object.values(address).join('/')}`);
      return ledger.readProjectedRows(projection, address, query);
    },
  };
}

export async function assessing({ ledger, goals, watching = '', ...switches }: Serving): Promise<Assessing> {
  const asked: string[] = [];
  const counts = { tests: 0 };
  const watched: Watching = {
    source: watching,
    tested: () => {
      counts.tests += 1;
    },
  };
  const composed = Promise.withResolvers<Ledger['Service']>();
  const clock = wokenClock(testServersStartAt);
  const server = await servingReasoningWithGoals([], {}, undefined, {
    ledger,
    clock,
    goalsResults: switches.results ?? true,
    goalsMessages: switches.messages ?? true,
    ledgerOver: (kept) => {
      const counted = countedOver(kept, (one) => {
        asked.push(one);
      });
      composed.resolve(counted);
      return counted;
    },
    programPoolOf: (settings, handed) => {
      const pool = patientThreadPool(settings, handed);
      return { ...pool, evaluations: { ...pool.evaluations, filters: watchedOver(pool.evaluations.filters, watched) } };
    },
  });
  await createdWithGoals(server, { goals });
  return {
    server,
    clock,
    asked,
    watched: { tests: () => counts.tests },
    rowsOf: async (table, playbook = 'alpha') => {
      const kept = await composed.promise;
      const rows = await Effect.runPromise(
        kept.readProjectedRows(table, { org: 'acme', playbook }, { where: [], orderBy: [], order: 'asc', limit: 1000 }),
      );
      return Object.fromEntries(rows.map(({ key, row }) => [key, row]));
    },
    ledger: () => composed.promise,
    ranAMinuteOn: () => {
      clock.moveTo(clock.now() + aMinuteAndASecond);
    },
  };
}

export function contributingWorkflow(name: string, lines: readonly string[]): string {
  return workflowSource(name, [...lines, ''].join('\n'));
}

export async function savedWorkflow(
  server: ReasoningServer,
  name: string,
  lines: readonly string[],
  playbook = alpha,
): Promise<number> {
  const listed = await server.call('GET', `${playbook}/definitions/workflow/${name}`);
  const source = contributingWorkflow(name, lines);
  const saved =
    listed.status === 200
      ? await server.call('PUT', `${playbook}/definitions/workflow/${name}`, { body: { source } })
      : await server.call('POST', `${playbook}/definitions/workflow`, { body: { name, source } });
  return saved.status;
}

const ListedRuns = Schema.Struct({ runs: Schema.Array(Schema.Struct({ status: Schema.String })) });

export async function succeededRunsOf(
  { server }: Pick<Assessing, 'server'>,
  name: string,
  playbook = alpha,
): Promise<number> {
  const listed = await server.call('GET', `${playbook}/runs?type=workflow&name=${name}`);
  return Schema.decodeUnknownSync(ListedRuns)(listed.body).runs.filter(({ status }) => status === 'succeeded').length;
}

/** The value once it holds, the clock moved on a minute at a time while the server is at rest and it does not. */
export function minuteByMinute<A>(
  assessed: Pick<Assessing, 'clock'>,
  read: () => A | Promise<A>,
  holds: (value: A) => boolean,
): Promise<A> {
  return assessed.clock.steppedEvery(aMinuteAndASecond).until(read, holds, fewSweeps);
}

/** The runs of the workflow once one ran, the clock moved on a minute at a time while none did. */
export function ranOnItsSchedule(assessed: Assessing, name: string): Promise<number> {
  return minuteByMinute(
    assessed,
    () => succeededRunsOf(assessed, name),
    (runs) => runs > 0,
  );
}

export interface Evaluated {
  readonly runs: number;
  readonly tests: number;
}

export function evaluatedOnceARun(assessed: Assessing, name: string, perRun: number): Promise<Evaluated> {
  return assessed.clock.swept.until(
    async (): Promise<Evaluated> => ({ runs: await succeededRunsOf(assessed, name), tests: assessed.watched.tests() }),
    ({ runs, tests }) => tests === perRun * runs,
    fewSweeps,
  );
}
