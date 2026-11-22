import type { CancelRun, RunEvent } from '@on.auto/definitions';
import type { CallerIdentity, Outcome, PlaybookRequest } from '@on.auto/operations';
import { statement, type DueItem, type GoneHolders, type WorkflowStore } from '@on.auto/workflow-host';
import { Effect, Function, Schema } from 'effect';

import type { AttemptHolding, ProcessStopping } from '../../attempt-leases/attempt-holding.ts';
import { attemptsWorkOf } from '../../attempt-leases/attempts-work.ts';
import { goneHoldersOn, type GoneHolderParts } from '../../attempt-leases/gone-holders.ts';
import { somethingHappened } from '../waiting/happenings.ts';
import { runtimeRecording } from './recorded-runtime.ts';

export const run = { org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

export const writer: CallerIdentity = {
  id: 'acme-writer',
  name: 'acme-writer',
  org: 'acme',
  permissions: ['playbook:write'],
  playbooks: '*',
};

const ran: Outcome = { status: 'succeeded', output: { status: 'succeeded' } };

const LeaseRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String, holder: Schema.String })));

export interface Given {
  readonly startedBy?: string;
  readonly events?: readonly RunEvent[];
  readonly context?: Readonly<Record<string, unknown>>;
  readonly answered?: Outcome;
  readonly notMade?: Effect.Effect<never>;
  /** The dispatch's answer, given when this ends, where a test holds the attempt while it works. */
  readonly answeredOnce?: Promise<void>;
  readonly callerNow?: CallerIdentity;
}

type LeaseRow = readonly [name: string, holder: string, expiresAt: number];

interface Asked {
  readonly nextAsked: () => readonly PlaybookRequest[];
  readonly refusedAsked: () => readonly PlaybookRequest[];
  readonly leases: () => Promise<readonly { readonly name: string; readonly holder: string }[]>;
}

interface GoneHoldersGiven extends Asked {
  readonly gone: GoneHolders;
}

interface AttemptsWorkGiven extends Asked {
  readonly dueAt: (now: number) => Promise<readonly DueItem[]>;
  readonly nextDueAfter: (after: number) => Promise<number | null>;
  readonly stopping: ProcessStopping;
}

export function startedBy(id: string): RunEvent {
  return { type: 'run_started', data: { started_by: { id, name: id }, playbook: 'alpha', input: {}, resumes: true } };
}

export const at = Date.parse('2026-11-15T09:00:00.000Z');

const leasesRead = statement`SELECT name, holder FROM workflow_leases WHERE name LIKE 'attempt/%' ORDER BY name`;

function leasesWritten(store: WorkflowStore, rows: readonly LeaseRow[]) {
  return Effect.forEach(
    rows,
    ([name, holder, expiresAt]) =>
      Effect.orDie(
        store.database.write(
          statement`INSERT INTO workflow_leases (name, holder, expires_at) VALUES (${name}, ${holder}, ${expiresAt})`,
        ),
      ),
    { discard: true },
  );
}

function told<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> {
  return Effect.ensuring(effect, Effect.sync(somethingHappened));
}

/** The store, telling the waiting tests of each lease it writes: taken, let go or handed over. */
function writesTold(store: WorkflowStore): WorkflowStore {
  const { database } = store;
  return {
    ...store,
    database: {
      ...database,
      write: (written) => told(database.write(written)),
    },
  };
}

async function partsGiven(given: Readonly<Given>, holding: AttemptHolding, leaseRows: readonly LeaseRow[] = []) {
  const { startedBy: by = writer.id, answered = ran, notMade, answeredOnce = Promise.resolve() } = given;
  const definition = { definitionType: 'reasoning', definitionName: 'summary', definitionVersion: 1 };
  const { runtime, store: recordingStore } = await runtimeRecording({
    definition: { type: definition.definitionType, name: definition.definitionName },
    events: given.events ?? [startedBy(by)],
    context: { runId: run.runId, by, at: new Date(at).toISOString(), ...definition, ...given.context },
  });
  const store = writesTold(recordingStore);
  await Effect.runPromise(leasesWritten(store, leaseRows));
  const asked: { next: PlaybookRequest[]; refused: PlaybookRequest[] } = { next: [], refused: [] };
  const parts: Omit<GoneHolderParts, 'callers' | 'holding'> = {
    runtime,
    store,
    dispatches: {
      nextAttempt: (request) =>
        Effect.andThen(
          Effect.sync(() => {
            asked.next.push(request);
            somethingHappened();
          }),
          notMade ??
            Effect.as(
              Effect.promise(() => answeredOnce),
              answered,
            ),
        ),
      refusedAttempt: (request) =>
        Effect.sync(() => {
          asked.refused.push(request);
          somethingHappened();
          return ran;
        }),
    },
  };
  const leases = async () => LeaseRows(await Effect.runPromise(Effect.orDie(store.database.read(leasesRead))));
  return {
    parts: { ...parts, holding },
    asked: { nextAsked: () => asked.next, refusedAsked: () => asked.refused, leases },
  };
}

function aStopOfTheProcess(): ProcessStopping {
  const stop = { begun: false };
  return {
    began: () => {
      stop.begun = true;
    },
    underway: () => stop.begun,
  };
}

const atTheTestsTime = () => at;

function holdingOf(stopping: ProcessStopping): AttemptHolding {
  return { holder: 'this-process', sweepEveryMs: 1000, clock: { now: atTheTestsTime, sleep: Effect.sleep }, stopping };
}

export async function goneHoldersGiven(given: Readonly<Given>): Promise<GoneHoldersGiven> {
  const { parts, asked } = await partsGiven(given, holdingOf(aStopOfTheProcess()));
  const callers = { readsAgain: (id: string) => id === writer.id, callerOf: () => Promise.resolve(given.callerNow) };
  return { gone: goneHoldersOn({ ...parts, callers }), ...asked };
}

const cancelNothing: CancelRun = Function.constant(Effect.succeed('unknown_run'));

const loopbackAccess = { host: '127.0.0.1', apiKeys: [], signIn: undefined, accessMode: undefined } as const;

const mostDue = 8;

function soonestOf(nexts: readonly (number | null)[]): number | null {
  const known = nexts.filter((next) => next !== null);
  return known.length === 0 ? null : Math.min(...known);
}

export async function attemptsWorkGiven(
  given: Readonly<Given>,
  leaseRows: readonly LeaseRow[],
): Promise<AttemptsWorkGiven> {
  const stopping = aStopOfTheProcess();
  const { parts, asked } = await partsGiven(given, holdingOf(stopping), leaseRows);
  const works = attemptsWorkOf({ ...parts, access: loopbackAccess, now: atTheTestsTime }).dueWorkOf(cancelNothing);
  return {
    dueAt: (now) =>
      Effect.runPromise(
        Effect.map(
          Effect.forEach(works, (work) => work.due(now, mostDue, false)),
          (due: readonly (readonly DueItem[])[]) => due.flat(),
        ),
      ),
    nextDueAfter: (after) =>
      Effect.runPromise(
        Effect.map(
          Effect.forEach(works, (work) => work.nextDueAt(after)),
          soonestOf,
        ),
      ),
    stopping,
    ...asked,
  };
}
