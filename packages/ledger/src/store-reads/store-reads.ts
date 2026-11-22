import { AsyncLocalStorage } from 'node:async_hooks';

export interface ReadSpent {
  readonly n: number;
  readonly rows?: number;
  readonly written?: number;
  readonly events?: number;
  readonly ms?: number;
}

export type StoreReads = Readonly<Record<string, ReadSpent>>;

export interface StatementCounted {
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export type StatementEnded = (counted: StatementCounted) => void;

export type ReadClock = () => number;

export interface StoreReadsTally {
  readonly run: <A>(work: () => A) => A;
  readonly taken: () => StoreReads;
}

interface Entry {
  readonly started: () => StatementEnded;
  readonly folded: (events: number) => void;
  readonly added: (spent: ReadSpent) => void;
  readonly isEmpty: () => boolean;
  readonly spent: () => ReadSpent;
}

interface Tally {
  readonly entryOf: (name: string) => Entry;
  readonly isClosed: () => boolean;
}

interface KeptTally extends Tally {
  readonly entries: () => readonly (readonly [string, Entry])[];
  readonly close: () => void;
}

interface UnderWay {
  readonly tally: Tally;
  readonly entry: Entry;
}

type NamedSpent = readonly [string, ReadSpent];

export const unnamedRead = 'unnamed';

export const otherReads = 'other';

export const mostReadsNamed = 8;

const longestReadName = 48;

const aReadName = /^[a-z][a-z0-9_]{0,30}(?:[.:][a-z][a-z0-9_]{0,30})*$/u;

const aStreamKind = /^[a-z][a-z0-9_]{0,30}$/u;

const nothingSpent: Required<ReadSpent> = { n: 0, rows: 0, written: 0, events: 0, ms: 0 };

const underWay = new AsyncLocalStorage<UnderWay>();

function isReadName(name: string): boolean {
  return name.length <= longestReadName && aReadName.test(name);
}

export function readNameOfStream(prefix: string, stream: string): string {
  const [scope = '', , third = '', fourth = ''] = stream.split('/');
  const kind = new Map([
    ['org', third],
    ['playbook', fourth],
    ['definition', fourth],
  ]).get(scope);
  if (kind === undefined) {
    return `${prefix}:${otherReads}`;
  }
  return `${prefix}:${scope}.${aStreamKind.test(kind) ? kind : otherReads}`;
}

function rowsIn(counted: StatementCounted, key: keyof StatementCounted): number {
  const rows = counted[key];
  return Number.isFinite(rows) && rows > 0 ? rows : 0;
}

function summedSpent(one: Required<ReadSpent>, other: ReadSpent): Required<ReadSpent> {
  return {
    n: one.n + other.n,
    rows: one.rows + (other.rows ?? 0),
    written: one.written + (other.written ?? 0),
    events: one.events + (other.events ?? 0),
    ms: one.ms + (other.ms ?? 0),
  };
}

function withoutNothing({ n, rows, written, events, ms }: Required<ReadSpent>, timed: boolean): ReadSpent {
  return {
    n,
    ...(rows === 0 ? {} : { rows }),
    ...(written === 0 ? {} : { written }),
    ...(events === 0 ? {} : { events }),
    ...(ms === 0 && !timed ? {} : { ms: Math.round(ms) }),
  };
}

function entryMade(clock: ReadClock | undefined): Entry {
  const own = { statements: 0, events: 0, ms: 0 };
  const counted: StatementCounted[] = [];
  const added: ReadSpent[] = [];
  return {
    started: () => {
      own.statements += 1;
      const startedAt = clock?.() ?? 0;
      return (answered) => {
        counted.push(answered);
        own.ms += clock === undefined ? 0 : clock() - startedAt;
      };
    },
    folded: (events) => {
      own.events += events;
    },
    added: (spent) => {
      added.push(spent);
    },
    isEmpty: () => own.statements === 0 && own.events === 0 && added.length === 0,
    spent: () => {
      const read: Required<ReadSpent> = {
        n: own.statements,
        rows: counted.reduce((sum, answered) => sum + rowsIn(answered, 'rowsRead'), 0),
        written: counted.reduce((sum, answered) => sum + rowsIn(answered, 'rowsWritten'), 0),
        events: own.events,
        ms: own.ms,
      };
      return withoutNothing(
        added.reduce((summed: Required<ReadSpent>, spent: ReadSpent) => summedSpent(summed, spent), read),
        clock !== undefined,
      );
    },
  };
}

function tallyMade(clock: ReadClock | undefined): KeptTally {
  const entries = new Map<string, Entry>();
  const state = { closed: false };
  return {
    entryOf: (name) => {
      const kept = entries.get(name) ?? entryMade(clock);
      entries.set(name, kept);
      return kept;
    },
    isClosed: () => state.closed,
    entries: () => [...entries],
    close: () => {
      state.closed = true;
    },
  };
}

export function storeReadsTally(clock?: ReadClock): StoreReadsTally {
  const tally = tallyMade(clock);
  const outside = { tally, entry: tally.entryOf(unnamedRead) };
  return {
    run: (work) => underWay.run(outside, work),
    taken: () => {
      tally.close();
      return Object.fromEntries(
        tally
          .entries()
          .flatMap(([name, entry]) => (name === unnamedRead && entry.isEmpty() ? [] : [[name, entry.spent()]])),
      );
    },
  };
}

function tallyUnderWay(): UnderWay | undefined {
  const at = underWay.getStore();
  return at === undefined || at.tally.isClosed() ? undefined : at;
}

export async function readNamed<A>(name: string, work: () => Promise<A>, eventsOf?: (answer: A) => number): Promise<A> {
  const at = tallyUnderWay();
  if (at === undefined) {
    return work();
  }
  const entry = at.tally.entryOf(isReadName(name) ? name : unnamedRead);
  const answer = await underWay.run({ tally: at.tally, entry }, work);
  entry.folded(eventsOf?.(answer) ?? 0);
  return answer;
}

export function statementStarted(): StatementEnded | undefined {
  return tallyUnderWay()?.entry.started();
}

export function storeReadsAdded(reads: StoreReads): void {
  const at = tallyUnderWay();
  if (at === undefined) {
    return;
  }
  for (const [name, spent] of Object.entries(reads)) {
    at.tally.entryOf(isReadName(name) ? name : unnamedRead).added(spent);
  }
}

export function outsideAnyTally<A>(work: () => A): A {
  return underWay.exit(work);
}

export function storeReadsSummed(one: StoreReads, other: StoreReads): StoreReads {
  const names = new Set([...Object.keys(one), ...Object.keys(other)]);
  return Object.fromEntries(
    [...names].map((name) => {
      const summed = summedSpent(summedSpent(nothingSpent, one[name] ?? nothingSpent), other[name] ?? nothingSpent);
      return [name, withoutNothing(summed, false)];
    }),
  );
}

const rowsReadBy = ({ rows = 0 }: ReadSpent): number => rows;

export function heaviestReads(reads: StoreReads, most: number): StoreReads {
  const byRows = Object.entries(reads).toSorted(
    ([, one]: NamedSpent, [, other]: NamedSpent) => rowsReadBy(other) - rowsReadBy(one),
  );
  if (byRows.length <= most) {
    return reads;
  }
  const rest = byRows
    .slice(most)
    .reduce((summed: Required<ReadSpent>, [, spent]: NamedSpent) => summedSpent(summed, spent), nothingSpent);
  return Object.fromEntries([...byRows.slice(0, most), [otherReads, withoutNothing(rest, false)]]);
}
