import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import type { DueWork } from '../due-work/due-work.ts';
import {
  attemptKeyOfRun,
  attemptLeaseMsFor,
  attemptLeasesOn,
  attemptLeasesRenewed,
  type AttemptLeases,
} from '../lease/attempt-leases.ts';
import { goneHoldersWork, type GoneHolders, type HolderGoneReceipt } from '../lease/gone-holders.ts';
import type { RunInAPlaybook } from '../runs/run-address.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';

export const sweepEveryMs = 10_000;

export const lastsMs = attemptLeaseMsFor(sweepEveryMs);

export const started = 1_790_845_200_000;

export const first: RunInAPlaybook = { org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-0000000000a1' };

export const second: RunInAPlaybook = { org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-0000000000a2' };

export const firstKey = attemptKeyOfRun(first);

export const secondKey = attemptKeyOfRun(second);

const LeaseRowSchema = Schema.Struct({ name: Schema.String, holder: Schema.String, expires_at: WholeNumber });

type LeaseRow = typeof LeaseRowSchema.Type;

interface Answers {
  readonly receipt?: HolderGoneReceipt;
  readonly holding?: number;
}

export interface Shared {
  readonly later: (ms: number) => void;
  readonly processNamed: (holder: string) => AttemptLeases;
  readonly renewedBy: (holder: string) => Promise<void>;
  readonly rows: () => Promise<readonly LeaseRow[]>;
  readonly sweptBy: (holder: string) => Promise<readonly string[]>;
  readonly soonestFor: (holder: string) => Promise<number | null>;
  readonly forCallsOut: (holder: string) => Promise<readonly [readonly unknown[], number | null]>;
  readonly ended: () => readonly (readonly [string, number])[];
  readonly resumed: () => readonly string[];
  readonly answering: (answers: Answers) => void;
}

const allRows = statement`SELECT name, holder, expires_at FROM workflow_leases ORDER BY name`;

export function leaseRowsOn(database: HostDatabase): Promise<readonly LeaseRow[]> {
  return Effect.runPromise(Effect.orDie(rowsOf(LeaseRowSchema, database.read(allRows))));
}

function settingsFor(holder: string) {
  return { holder, sweepEveryMs };
}

async function performedBy(work: DueWork, now: number): Promise<readonly string[]> {
  const items = await Effect.runPromise(Effect.orDie(work.due(now, 256, false)));
  await Effect.runPromise(Effect.orDie(Effect.forEach(items, (item) => item.perform(now), { discard: true })));
  return items.map(({ key }) => key);
}

export async function sharedOn(settingsOf: SettingsOf): Promise<Shared> {
  const time = { now: started };
  const opened = await openedOn(await settingsOf());
  const database: HostDatabase = { ...opened, sharedClock: Effect.sync(() => time.now) };
  const asked: { ended: (readonly [string, number])[]; resumed: string[]; answers: Answers } = {
    ended: [],
    resumed: [],
    answers: {},
  };
  const gone: GoneHolders = {
    holdingOf: () => Effect.sync(() => asked.answers.holding),
    ended: (run, fencingToken) =>
      Effect.sync(() => {
        asked.ended.push([attemptKeyOfRun(run), fencingToken]);
        return asked.answers.receipt ?? 'ended';
      }),
    resumed: (run) =>
      Effect.sync(() => {
        asked.resumed.push(attemptKeyOfRun(run));
      }),
  };
  return {
    later: (ms) => {
      time.now += ms;
    },
    processNamed: (holder) => attemptLeasesOn(database, settingsFor(holder)),
    renewedBy: (holder) => Effect.runPromise(Effect.orDie(attemptLeasesRenewed(database, settingsFor(holder)))),
    rows: () => leaseRowsOn(database),
    sweptBy: (holder) => performedBy(goneHoldersWork(database, settingsFor(holder), gone), time.now),
    soonestFor: (holder) =>
      Effect.runPromise(Effect.orDie(goneHoldersWork(database, settingsFor(holder), gone).nextDueAt(time.now))),
    forCallsOut: (holder) => {
      const work = goneHoldersWork(database, settingsFor(holder), gone);
      return Effect.runPromise(
        Effect.orDie(Effect.all([work.due(time.now, 16, true), work.nextDueAt(time.now, true)])),
      );
    },
    ended: () => asked.ended,
    resumed: () => asked.resumed,
    answering: (answers) => {
      asked.answers = answers;
    },
  };
}

type Step = (runKey: string) => Effect.Effect<void, unknown>;

export function steppedThrough(address: RunInAPlaybook, ...steps: readonly Step[]): Promise<void> {
  const runKey = attemptKeyOfRun(address);
  return Effect.runPromise(Effect.orDie(Effect.forEach(steps, (step) => step(runKey), { discard: true })));
}

export function heldBy(process: AttemptLeases, address: RunInAPlaybook, fencingToken: number): Promise<void> {
  return steppedThrough(address, process.taken, (runKey) => process.named(runKey, fencingToken));
}
