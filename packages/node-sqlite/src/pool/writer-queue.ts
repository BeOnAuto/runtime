import { AsyncLocalStorage } from 'node:async_hooks';

import { Abort, DumboError, type PoolCloseOptions } from '@event-driven-io/dumbo';

import type { ReadonlyAbort, ReadonlyAbortContext, ReadonlyAbortOptions } from '../client/readonly-options.ts';

export interface WriterQueueBounds {
  readonly mostWaiting: number;
  readonly longestWaitToStart: number;
  readonly onWaiting?: (() => void) | undefined;
}

type WriterTask<A> = (context: ReadonlyAbortContext) => Promise<A>;

export interface WriterQueue {
  readonly run: <A>(task: WriterTask<A>, options?: ReadonlyAbortOptions) => Promise<A>;
  readonly stop: (options?: Readonly<PoolCloseOptions>) => Promise<void>;
}

interface Turn {
  readonly begin: () => Promise<void>;
  readonly refuse: (reason: Readonly<Error>) => void;
  readonly abort: (reason: Readonly<Error>) => void;
}

interface Waiting {
  readonly leave: (turn: Turn) => boolean;
  readonly longestWaitToStart: number;
}

export const tooManyWaiting = 'Too many pending tasks. Please try again later.';

export const notStartedInTime = 'Task was not started within the maximum waiting time';

export const writerClosed = 'Writer connection pool has been closed';

function turnOf<A>(
  task: WriterTask<A>,
  abort: ReadonlyAbort | undefined,
  answer: Readonly<PromiseWithResolvers<A>>,
  { leave, longestWaitToStart }: Waiting,
): Turn {
  const inTheCallersContext = AsyncLocalStorage.snapshot();
  const scope = Abort.scope(abort, (reason: Readonly<Error>) => {
    if (leave(turn)) {
      clearTimeout(expiry);
      scope.dispose();
    }
    answer.reject(reason);
  });
  const turn: Turn = {
    begin: async () => {
      clearTimeout(expiry);
      try {
        answer.resolve(await inTheCallersContext(() => task({ abort: scope })));
      } catch (error: unknown) {
        answer.reject(error);
      } finally {
        scope.dispose();
      }
    },
    refuse: (reason) => {
      clearTimeout(expiry);
      scope.dispose();
      answer.reject(reason);
    },
    abort: (reason) => {
      scope.abort(reason);
      answer.reject(reason);
    },
  };
  const expiry = setTimeout(() => {
    leave(turn);
    turn.refuse(new DumboError(notStartedInTime));
  }, longestWaitToStart).unref();
  return turn;
}

function endOf(running: Promise<void>, { force = false, closeDeadline }: Readonly<PoolCloseOptions>): Promise<void> {
  if (force) {
    return Promise.resolve();
  }
  return closeDeadline === undefined
    ? running
    : Promise.race([
        running,
        new Promise<void>((resolve) => {
          setTimeout(resolve, closeDeadline).unref();
        }),
      ]);
}

export function writerQueue({ mostWaiting, longestWaitToStart, onWaiting }: WriterQueueBounds): WriterQueue {
  const waiting = new Set<Turn>();
  const now: { turn?: Turn; running: Promise<void>; stopped: boolean } = { running: Promise.resolve(), stopped: false };
  const startNext = (): void => {
    const [next] = waiting;
    if (now.turn === undefined && next !== undefined) {
      waiting.delete(next);
      now.turn = next;
      now.running = next.begin().finally(() => {
        delete now.turn;
        startNext();
      });
    }
  };
  const leave = (turn: Turn): boolean => waiting.delete(turn);
  return {
    run: <A>(task: WriterTask<A>, options: ReadonlyAbortOptions = {}): Promise<A> => {
      const refusal = Abort.rejectIfAborted(options);
      if (refusal !== undefined) {
        return refusal;
      }
      if (now.stopped || waiting.size >= mostWaiting) {
        return Promise.reject(new DumboError(now.stopped ? writerClosed : tooManyWaiting));
      }
      const answer = Promise.withResolvers<A>();
      const turn = turnOf(task, options.abort, answer, { leave, longestWaitToStart });
      waiting.add(turn);
      startNext();
      if (waiting.has(turn)) {
        onWaiting?.();
      }
      return answer.promise;
    },
    stop: async (options = {}) => {
      if (!now.stopped) {
        now.stopped = true;
        for (const turn of waiting) {
          turn.refuse(new DumboError(writerClosed));
        }
        waiting.clear();
        if (options.force === true) {
          now.turn?.abort(new DumboError(writerClosed));
        }
        await endOf(now.running, options);
      }
    },
  };
}
