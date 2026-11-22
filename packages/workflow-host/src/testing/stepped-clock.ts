import { Context } from 'effect';

import { ForkWatch, type HostContext } from '../loop/forked-fibers.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { heldOn, queuedOn, sleepOn, sleepOrOn, watchedFibers, type HeldWork, type Sleeper } from './clock-sleepers.ts';
import { signals, type Signals } from './signals.ts';

export interface SteppedClock extends HostClock {
  readonly step: (milliseconds: number) => void;
  readonly asleep: () => number;
  readonly asleepAtLeast: (sleepers: number) => Promise<number>;
  readonly when: Signals['when'];
  /** The context given, with a watch on the fibers a host forks, for the host on this clock to be given. */
  readonly watching: (context?: HostContext) => Context.Context<never>;
  /**
   * Answers once the host is wholly at rest: every fiber it forked that still lives is asleep on this clock. It fails
   * when no host was given `watching`, as no rest of one could be known.
   */
  readonly atRest: () => Promise<void>;
  /** Work the test holds, which a host waits for asleep on this clock, so it can still come to rest. */
  readonly hold: () => HeldWork;
  /**
   * Work that waits its turn: the fiber counts as held, as a fiber waiting for work the test holds does, until
   * `permitted` runs, and as awake from then on, so a host can come to rest while one of its fibers holds the turn.
   */
  readonly queued: NonNullable<HostClock['queued']>;
  /**
   * The labels of the fibers the host forked that still live and neither sleep on this clock nor wait on it, as a host
   * that never comes to rest names them; none once it is at rest.
   */
  readonly awake: () => readonly string[];
}

/**
 * The real `setImmediate`, taken as this module loads, before a test can fake the timers: the rest of a host is decided
 * there, and a faked one would never run.
 */
const atTheNextMacrotask = setImmediate;

interface Rest {
  readonly reached: () => Promise<void>;
  readonly changed: () => void;
}

/**
 * The rest of a host, decided only where no work is queued to run. A wake-up a fiber has already caused (a signal it
 * resolved, or its own end, that a loop waits on) reaches the loop as a queued microtask, and no count taken before
 * that runs can see it: the loop is still counted asleep then, though it is about to work. The queue of microtasks is
 * empty each time a macrotask starts, so the census is taken there, once after each change while a test waits for
 * rest: never on a timer, never a number of turns, and never again without a change. A census that does not hold
 * there waits for the next change, as only a change can make it hold.
 */
function restOf(census: () => boolean): Rest {
  const waiting: (() => void)[] = [];
  const check = { queued: false };
  const decided = () => {
    check.queued = false;
    if (census()) {
      for (const rested of waiting.splice(0)) {
        rested();
      }
    }
  };
  const queued = () => {
    if (!check.queued && waiting.length > 0) {
      check.queued = true;
      atTheNextMacrotask(decided);
    }
  };
  return {
    reached: () =>
      new Promise<void>((resolve) => {
        waiting.push(resolve);
        queued();
      }),
    changed: queued,
  };
}

interface HandOvers {
  readonly pending: () => boolean;
  readonly begun: () => void;
}

/**
 * The permits that turns which ended let go. Effect's semaphore hands a permit let go to the next fiber waiting for it
 * only at its next task, a macrotask later, so until then that fiber still counts as queued, held, though it is about
 * to work. A hand-over is over at the macrotask after the one the semaphore queued, the fiber's turn taken by then.
 */
function handOversOn(seen: Signals): HandOvers {
  const counts = { pending: 0 };
  return {
    pending: () => counts.pending > 0,
    begun: () => {
      counts.pending += 1;
      atTheNextMacrotask(() => {
        counts.pending -= 1;
        seen.changed();
      });
    },
  };
}

export function steppedClock(start: number): SteppedClock {
  const time = { now: start };
  const sleepers = new Set<Sleeper>();
  const told = signals();
  const asleep = () => sleepers.size;
  const rest = restOf(() => asleep() >= fibers.living() && !handOvers.pending());
  const seen: Signals = {
    ...told,
    changed: () => {
      told.changed();
      rest.changed();
    },
  };
  const fibers = watchedFibers(seen);
  const handOvers = handOversOn(seen);
  return {
    now: () => time.now,
    sleep: sleepOn(time, sleepers, seen),
    sleepOr: sleepOrOn(time, sleepers, seen),
    step: (milliseconds) => {
      time.now += milliseconds;
      for (const sleeper of [...sleepers].filter((sleeping) => sleeping.until <= time.now)) {
        sleepers.delete(sleeper);
        sleeper.wake();
      }
    },
    asleep,
    asleepAtLeast: (count) => seen.when(asleep, (sleeping) => sleeping >= count),
    when: seen.when,
    hold: () => heldOn(sleepers, seen),
    queued: queuedOn(sleepers, seen, handOvers.begun),
    awake: () => fibers.awake(sleepers),
    watching: (context) => Context.add(context ?? Context.empty(), ForkWatch, fibers.watch),
    atRest: async () => {
      if (!fibers.watched()) {
        throw new Error('No host on this clock was given its watching context, so its rest cannot be known');
      }
      await rest.reached();
    },
  };
}

export interface SweepsAtMost {
  readonly atMost: number;
}

/** The most sweeps one wait of a test steps: a few, since a host does each thing at its next sweep. */
export const fewSweeps: SweepsAtMost = { atMost: 10 };

/**
 * Answers once a read of what the host keeps holds. Each time the host is wholly at rest, every fiber it forked
 * asleep on the clock, and the read does not hold, the clock steps one sweep; it steps `atMost` sweeps at most, and then fails
 * saying how far it stepped.
 */
interface SweptUntil {
  <A, B extends A>(read: () => A | Promise<A>, holds: (value: A) => value is B, bound: SweepsAtMost): Promise<B>;
  <A>(read: () => A | Promise<A>, holds: (value: A) => boolean, bound: SweepsAtMost): Promise<A>;
}

export interface SteppedSweeps {
  readonly until: SweptUntil;
  /** Answers once the host is wholly at rest, stepping nothing. */
  readonly rested: () => Promise<void>;
}

/**
 * TIME MOVES ONLY WHEN THE TEST MOVES IT, IN STEPS THE TEST NAMES.
 *
 * A host on a stepped clock does what is due and sleeps; what falls due at its next sweep waits for the clock to reach
 * it. A test waiting for such work names how many sweeps it allows, and the clock steps one sweep at a time, only once
 * the host is at rest again, so no time passes that the test did not ask for.
 */
export function steppedBy(clock: SteppedClock, everyMs: number): SteppedSweeps {
  const stepped = async <A>(
    read: () => A | Promise<A>,
    holds: (value: A) => boolean,
    { atMost }: SweepsAtMost,
    steps: number,
  ): Promise<A> => {
    await clock.atRest();
    const value = await read();
    if (holds(value)) {
      return value;
    }
    if (steps >= atMost) {
      throw new Error(`It still did not hold after ${steps} sweeps of ${everyMs} ms, ${steps * everyMs} ms in all`);
    }
    clock.step(everyMs);
    return stepped(read, holds, { atMost }, steps + 1);
  };
  function until<A, B extends A>(
    read: () => A | Promise<A>,
    holds: (value: A) => value is B,
    bound: SweepsAtMost,
  ): Promise<B>;
  function until<A>(read: () => A | Promise<A>, holds: (value: A) => boolean, bound: SweepsAtMost): Promise<A>;
  function until<A>(read: () => A | Promise<A>, holds: (value: A) => boolean, bound: SweepsAtMost): Promise<A> {
    return stepped(read, holds, bound, 0);
  }
  return {
    until,
    rested: clock.atRest,
  };
}
