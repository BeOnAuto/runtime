import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';

import { Schema } from 'effect';

const threadStarts = 'worker_threads';

const decodeReport = Schema.decodeUnknownSync(Schema.Struct({ workers: Schema.Array(Schema.Unknown) }));

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ worker: Schema.instanceOf(EventEmitter) }));

const decodeThread = Schema.decodeUnknownSync(Schema.Struct({ threadId: Schema.Number }));

const ended = new Set<number>();

const endings = new Map<number, PromiseWithResolvers<void>>();

function endingOf(thread: number): PromiseWithResolvers<void> {
  const ending = endings.get(thread) ?? Promise.withResolvers<void>();
  endings.set(thread, ending);
  return ending;
}

subscribe(threadStarts, (started) => {
  const { worker } = decodeStarted(started);
  const { threadId } = decodeThread(worker);
  const ending = endingOf(threadId);
  worker.once('exit', () => {
    ended.add(threadId);
    ending.resolve();
  });
});

/**
 * Resolves once the thread has exited. The pool hears the exit in the same turn, before this resolves, since a
 * listener that runs on the exit only queues the resolution.
 */
export function threadEnding(thread: number): Promise<void> {
  return endingOf(thread).promise;
}

export function threadsAlive(): number {
  return decodeReport(process.report.getReport()).workers.length;
}

export function threadEnded(thread: number): boolean {
  return ended.has(thread);
}

export interface ThreadStarts {
  readonly counted: () => number;
  readonly stop: () => void;
}

export function countedThreadStarts(): ThreadStarts {
  const started = { threads: 0 };
  const heard = (): void => {
    started.threads += 1;
  };
  subscribe(threadStarts, heard);
  return {
    counted: () => started.threads,
    stop: () => {
      unsubscribe(threadStarts, heard);
    },
  };
}

export function nextThreadStarted(): Promise<number> {
  const { promise, resolve } = Promise.withResolvers<number>();
  const heard = (started: unknown): void => {
    unsubscribe(threadStarts, heard);
    resolve(decodeThread(decodeStarted(started).worker).threadId);
  };
  subscribe(threadStarts, heard);
  return promise;
}
