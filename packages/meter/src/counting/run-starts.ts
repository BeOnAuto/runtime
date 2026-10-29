import type { LoggedEvent, LogPorts } from '@on.auto/ledger';

export interface Counted {
  readonly actions: number;
  readonly through: readonly string[] | undefined;
  readonly last: string | undefined;
}

export interface Counting extends Counted {
  readonly hasStarted: (stream: string) => boolean;
}

export type FirstStartOf = (stream: string) => Promise<number | undefined>;

interface Tally {
  readonly firstsAmong: (starts: readonly LoggedEvent[]) => Promise<number>;
  readonly hasStarted: (stream: string) => boolean;
}

const RUN_STREAM = /^playbook\/[^/]+\/[^/]+\/runs\/[^/]+$/u;

const EVENTS_A_PAGE = 500;

function isRunStart({ type, stream }: LoggedEvent): boolean {
  return type === 'run_started' && RUN_STREAM.test(stream);
}

function freshTally(): Tally {
  const started = new Set<string>();
  const sightedFirst = ({ stream }: LoggedEvent): boolean => !started.has(stream) && Boolean(started.add(stream));
  return {
    firstsAmong: (starts) => Promise.resolve(starts.filter((start) => sightedFirst(start)).length),
    hasStarted: (stream) => started.has(stream),
  };
}

function tallyAfter(firstStartOf: FirstStartOf): Tally {
  const started = new Set<string>();
  const isFirst = async ({ stream, version }: LoggedEvent): Promise<boolean> =>
    (await firstStartOf(stream)) === version && Boolean(started.add(stream));
  return {
    firstsAmong: async (starts) => (await Promise.all(starts.map((start) => isFirst(start)))).filter(Boolean).length,
    hasStarted: (stream) => started.has(stream),
  };
}

async function countedOn(log: LogPorts, tally: Tally, counted: Counted): Promise<Counted> {
  const page = await log.after(counted.through, EVENTS_A_PAGE);
  const firsts = await tally.firstsAmong(page.events.filter((event) => isRunStart(event)));
  const last = page.events.at(-1);
  const next: Counted = {
    actions: counted.actions + firsts,
    through: last?.point ?? counted.through,
    last: last?.id ?? counted.last,
  };
  return page.more ? countedOn(log, tally, next) : next;
}

async function countedWith(log: LogPorts, tally: Tally, from: Counted): Promise<Counting> {
  return { ...(await countedOn(log, tally, from)), hasStarted: tally.hasStarted };
}

export function countedAfter(log: LogPorts, firstStartOf: FirstStartOf, from: Counted): Promise<Counting> {
  return countedWith(log, tallyAfter(firstStartOf), from);
}

export function countedFromTheStart(log: LogPorts): Promise<Counting> {
  return countedWith(log, freshTally(), { actions: 0, through: undefined, last: undefined });
}
