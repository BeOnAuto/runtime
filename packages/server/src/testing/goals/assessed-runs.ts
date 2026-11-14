import type { Ledger, ProjectedRow } from '@on.auto/operations';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { movedClock, type MovedClock } from '@on.auto/workflow-host/testing';
import { Effect, Schema } from 'effect';

import type { TemporaryLedger } from '../records/temporary-ledger.ts';
import { alpha, type ReasoningServer } from '../servers/reasoning-server.ts';
import { patientWorkerPool } from '../servers/worker-pools.ts';
import { workflowSource } from '../servers/workflow-server.ts';
import { createdWithGoals, servingReasoningWithGoals } from '../settings/goals-kept.ts';
import { until } from '../waiting/until.ts';

const aMinuteAndASecond = 61_000;

interface Watched {
  readonly tests: () => number;
}

export interface Assessing {
  readonly server: ReasoningServer;
  readonly clock: MovedClock;
  readonly asked: readonly string[];
  readonly watched: Watched;
  readonly rowsOf: (table: string, playbook?: string) => Promise<Readonly<Record<string, ProjectedRow>>>;
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
  const clock = movedClock(Date.now());
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
      const pool = patientWorkerPool(settings, handed);
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
    ranAMinuteOn: () => {
      clock.moveTo(clock.now() + aMinuteAndASecond);
    },
  };
}

export function contributingWorkflow(name: string, lines: readonly string[]): string {
  return workflowSource(name, [...lines, ''].join('\n'));
}

export async function savedWorkflow(server: ReasoningServer, name: string, lines: readonly string[]): Promise<number> {
  const listed = await server.call('GET', `${alpha}/definitions/workflow/${name}`);
  const source = contributingWorkflow(name, lines);
  const saved =
    listed.status === 200
      ? await server.call('PUT', `${alpha}/definitions/workflow/${name}`, { body: { source } })
      : await server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source } });
  return saved.status;
}

const ListedRuns = Schema.Struct({ runs: Schema.Array(Schema.Struct({ status: Schema.String })) });

export async function succeededRunsOf({ server }: Pick<Assessing, 'server'>, name: string): Promise<number> {
  const listed = await server.call('GET', `${alpha}/runs?type=workflow&name=${name}`);
  return Schema.decodeUnknownSync(ListedRuns)(listed.body).runs.filter(({ status }) => status === 'succeeded').length;
}

export function ranOnItsSchedule(assessed: Assessing, name: string): Promise<number> {
  return until(
    async () => {
      const runs = await succeededRunsOf(assessed, name);
      assessed.clock.moveTo(assessed.clock.now() + aMinuteAndASecond * Number(runs === 0));
      return runs;
    },
    (runs) => runs > 0,
  );
}

export interface Evaluated {
  readonly runs: number;
  readonly tests: number;
}

export function evaluatedOnceARun(assessed: Assessing, name: string, perRun: number): Promise<Evaluated> {
  return until(
    async (): Promise<Evaluated> => ({ runs: await succeededRunsOf(assessed, name), tests: assessed.watched.tests() }),
    ({ runs, tests }) => tests === perRun * runs,
  );
}
