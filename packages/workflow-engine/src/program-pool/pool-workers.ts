import { stopped } from '../jobs/job-endings.ts';
import type { Evaluate, Job } from '../jobs/pool-job.ts';
import type { StartThread, Thread, ThreadHooks } from './pool-threads.ts';

export const idleWorkerMs = 60_000;

export const jobsBeforeRecycling = 1000;

export interface RosterSettings {
  readonly workers: number;
  readonly idleMs?: number;
  readonly jobsPerWorker?: number;
}

export interface PoolWorkers<Message> {
  readonly evaluate: Evaluate<Message>;
  readonly close: () => Promise<void>;
}

interface Shelf<Message> {
  readonly forget: (thread: Thread<Message>) => void;
  readonly hold: (thread: Thread<Message>) => void;
  readonly rest: (thread: Thread<Message>) => void;
  readonly warm: (key: string) => Thread<Message> | undefined;
  readonly oldest: () => readonly Thread<Message>[];
  readonly all: () => readonly Thread<Message>[];
}

interface Fleet<Message> {
  readonly start: (work: Job<unknown, Message>, signal?: Readonly<AbortSignal>) => Promise<Thread<Message> | undefined>;
  readonly letGo: (thread: Thread<Message>) => Promise<unknown>;
  readonly ended: () => Promise<unknown>;
}

interface Seats<Message> {
  readonly free: () => boolean;
  readonly oldest: () => readonly Thread<Message>[];
  readonly letGo: (thread: Thread<Message>) => Promise<unknown>;
  readonly someEnded: () => Promise<unknown>;
}

interface Roster<Message> {
  readonly take: (work: Job<unknown, Message>, signal?: Readonly<AbortSignal>) => Promise<Thread<Message> | undefined>;
  readonly rest: (thread: Thread<Message>) => void;
  readonly letGo: (thread: Thread<Message>) => Promise<unknown>;
  readonly closing: () => boolean;
  readonly close: () => Promise<void>;
}

async function roomIn<Message>(seats: Seats<Message>): Promise<void> {
  if (seats.free()) {
    return;
  }
  for (const oldest of seats.oldest()) {
    void seats.letGo(oldest);
  }
  await seats.someEnded();
  await roomIn(seats);
}

function shelfOf<Message>(): Shelf<Message> {
  const idle: Thread<Message>[] = [];
  const busy = new Set<Thread<Message>>();
  const forget = (thread: Thread<Message>): void => {
    const at = idle.indexOf(thread);
    if (at !== -1) {
      idle.splice(at, 1);
    }
    busy.delete(thread);
  };
  return {
    forget,
    hold: (thread) => {
      forget(thread);
      busy.add(thread);
    },
    rest: (thread) => {
      forget(thread);
      idle.push(thread);
    },
    warm: (key) => idle.findLast((each) => each.key === key),
    oldest: () => idle.slice(0, 1),
    all: () => [...idle, ...busy],
  };
}

function fleetOf<Message>(
  settings: RosterSettings,
  shelf: Shelf<Message>,
  closing: () => boolean,
  startThread: StartThread<Message>,
): Fleet<Message> {
  const dying = new Set<Promise<unknown>>();
  const count = { alive: 0, starting: 0 };
  const letGo = (thread: Thread<Message>): Promise<unknown> => {
    shelf.forget(thread);
    const ended = thread.end();
    dying.add(ended);
    void ended.then(() => dying.delete(ended));
    return ended;
  };
  const hooks: ThreadHooks<Message> = {
    closing,
    troubled: (thread) => {
      void letGo(thread);
    },
    gone: (thread) => {
      shelf.forget(thread);
      count.alive -= 1;
    },
  };
  const seats: Seats<Message> = {
    free: () => closing() || count.alive + count.starting <= settings.workers,
    oldest: shelf.oldest,
    letGo,
    someEnded: () => Promise.race(dying),
  };
  const started = (work: Job<unknown, Message>): Thread<Message> => {
    const thread = startThread(work, hooks);
    count.alive += 1;
    return thread;
  };
  return {
    start: async (work, signal) => {
      count.starting += 1;
      await roomIn(seats);
      count.starting -= 1;
      return closing() || signal?.aborted === true ? undefined : started(work);
    },
    letGo,
    ended: () => Promise.all(dying),
  };
}

function rosterOf<Message>(
  settings: RosterSettings,
  idleMs: number,
  startThread: StartThread<Message>,
): Roster<Message> {
  const shelf = shelfOf<Message>();
  const state = { closing: false };
  const fleet = fleetOf(settings, shelf, () => state.closing, startThread);
  return {
    take: async (work, signal) => {
      const warm = shelf.warm(work.key);
      warm?.wake();
      const thread = warm ?? (await fleet.start(work, signal));
      if (thread !== undefined) {
        shelf.hold(thread);
      }
      return thread;
    },
    rest: (thread) => {
      shelf.rest(thread);
      thread.rest(idleMs, () => {
        void fleet.letGo(thread);
      });
    },
    letGo: fleet.letGo,
    closing: () => state.closing,
    close: async () => {
      state.closing = true;
      await Promise.all(shelf.all().map((thread) => fleet.letGo(thread)));
      await fleet.ended();
    },
  };
}

export function poolWorkers<Message>(
  settings: RosterSettings,
  startThread: StartThread<Message>,
): PoolWorkers<Message> {
  const jobsPerWorker = settings.jobsPerWorker ?? jobsBeforeRecycling;
  const roster = rosterOf(settings, settings.idleMs ?? idleWorkerMs, startThread);
  const jobs = { last: 0 };
  return {
    evaluate: async (work, running) => {
      const thread = await roster.take(work, running.signal);
      if (thread === undefined) {
        return stopped(roster.closing() ? 'closing' : 'cancelled');
      }
      if (running.signal?.aborted === true) {
        roster.rest(thread);
        return stopped('cancelled');
      }
      jobs.last += 1;
      const { ending, keep } = await thread.serve(jobs.last, work, running);
      if (keep && !roster.closing() && thread.jobs() < jobsPerWorker) {
        roster.rest(thread);
      } else {
        await roster.letGo(thread);
      }
      return ending;
    },
    close: roster.close,
  };
}
