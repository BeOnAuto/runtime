import { Context, Effect } from 'effect';

import type {
  AppendListeners,
  AppendWaited,
  AppendWaitsStore,
  FactScope,
  LatestAppends,
  ReadLatestAppends,
  RecordedPoint,
} from '../event-store.ts';
import { signalOf, type StreamSignal } from '../signal/append-signal.ts';

const lookEveryMs = 1000;

const messagesInOneLook = 1000;

const digitsOfTheLargestPart = 20;

interface Waiter {
  readonly scope: FactScope;
  readonly after: RecordedPoint;
  readonly settle: (waited: AppendWaited) => void;
}

interface Watching {
  readonly stop: () => void;
}

interface WatchState {
  readonly waiters: ReadonlySet<Waiter>;
  readonly through: RecordedPoint | undefined;
  readonly earliest: RecordedPoint | undefined;
  readonly looking: boolean;
  readonly again: boolean;
  readonly watching: Watching | undefined;
  readonly failing: boolean;
  readonly ended: boolean;
}

interface Watch {
  readonly readAppended: ReadLatestAppends;
  readonly appended: StreamSignal;
  readonly everyMs: number;
  readonly failed: (failure: unknown) => void;
  readonly state: () => WatchState;
  readonly changed: (change: Partial<WatchState>) => void;
}

const idle: WatchState = {
  waiters: new Set(),
  through: undefined,
  earliest: undefined,
  looking: false,
  again: false,
  watching: undefined,
  failing: false,
  ended: false,
};

function orderOf(point: RecordedPoint): string {
  return point.map((part) => part.padStart(digitsOfTheLargestPart, '0')).join(':');
}

export function isLater(left: RecordedPoint, right: RecordedPoint): boolean {
  return orderOf(left) > orderOf(right);
}

function earliestOf(left: RecordedPoint | undefined, right: RecordedPoint): RecordedPoint {
  return left === undefined || isLater(left, right) ? right : left;
}

export function inScope(scope: FactScope, appendedTo: string): boolean {
  if (scope.kind === 'playbook') {
    return appendedTo.startsWith(scope.playbookKey);
  }
  const ofAKind = appendedTo.endsWith('/');
  return scope.streams.some((stream) => stream === appendedTo || (ofAKind && stream.startsWith(appendedTo)));
}

function wokenBy({ latest }: LatestAppends, { scope, after }: Waiter): boolean {
  return [...latest].some(
    ([stream, point]: readonly [string, RecordedPoint]) => inScope(scope, stream) && isLater(point, after),
  );
}

function settled(watch: Watch, settling: readonly Waiter[], waited: AppendWaited): void {
  const waiters = new Set(watch.state().waiters);
  for (const waiter of settling) {
    waiters.delete(waiter);
  }
  watch.changed({ waiters });
  for (const waiter of settling) {
    waiter.settle(waited);
  }
}

function unwatched(watch: Watch): void {
  watch.state().watching?.stop();
  watch.changed({ watching: undefined, through: undefined });
}

async function lookedOnce(watch: Watch): Promise<void> {
  const { through, earliest } = watch.state();
  watch.changed({ earliest: undefined, again: false });
  const read = await watch.readAppended(
    earliest === undefined ? through : earliestOf(through, earliest),
    messagesInOneLook,
  );
  settled(
    watch,
    [...watch.state().waiters].filter((waiter) => wokenBy(read, waiter)),
    'appended',
  );
  watch.changed({ through: read.through, again: watch.state().again || read.more, failing: false });
}

async function lookedWhileWaited(watch: Watch): Promise<void> {
  if (watch.state().waiters.size === 0) {
    return undefined;
  }
  await lookedOnce(watch);
  return watch.state().again ? lookedWhileWaited(watch) : undefined;
}

function look(watch: Watch): void {
  if (watch.state().looking) {
    watch.changed({ again: true });
    return;
  }
  watch.changed({ looking: true });
  void lookedWhileWaited(watch)
    .catch((failure: unknown) => {
      if (!watch.state().failing) {
        watch.failed(failure);
      }
      watch.changed({ failing: true, again: false });
    })
    .finally(() => {
      watch.changed({ looking: false });
      if (watch.state().waiters.size === 0) {
        unwatched(watch);
      }
    });
}

function watched(watch: Watch): Watching {
  const looked = (): void => {
    look(watch);
  };
  const ticking = setInterval(looked, watch.everyMs).unref();
  const stopListening = watch.appended.listen(looked);
  return {
    stop: () => {
      clearInterval(ticking);
      stopListening();
    },
  };
}

function waitingIn(watch: Watch): AppendWaitsStore['waitForAppend'] {
  return (scope, after, signal) => {
    if (signal.aborted || watch.state().ended) {
      return Promise.resolve('ended');
    }
    const { promise, resolve } = Promise.withResolvers<AppendWaited>();
    const waiter: Waiter = { scope, after, settle: resolve };
    signal.addEventListener('abort', () => {
      settled(watch, [waiter], 'ended');
    });
    const { waiters, earliest, watching } = watch.state();
    watch.changed({ waiters: new Set([...waiters, waiter]), earliest: earliestOf(earliest, after) });
    watch.changed({ watching: watching ?? watched(watch) });
    look(watch);
    return promise;
  };
}

export function watchFailuresLoggedWith(context: Context.Context<never>): (failure: unknown) => void {
  return (failure) => {
    Effect.runForkWith(context)(
      Effect.logError(
        'The ledger could not read which streams were appended to; the requests that wait for an append wait on, and it reads again in a second',
        failure,
      ),
    );
  };
}

export function appendWatchOf(
  readAppended: ReadLatestAppends,
  listeners: AppendListeners,
  everyMs = lookEveryMs,
): AppendWaitsStore {
  const appended = signalOf(listeners);
  const held = { state: idle };
  const watch: Watch = {
    readAppended,
    appended,
    everyMs,
    failed: listeners.watchFailed ?? watchFailuresLoggedWith(Context.empty()),
    state: () => held.state,
    changed: (change) => {
      held.state = { ...held.state, ...change };
    },
  };
  return {
    waitForAppend: waitingIn(watch),
    endWaits: () => {
      watch.changed({ ended: true });
      settled(watch, [...watch.state().waiters], 'ended');
      unwatched(watch);
    },
  };
}
