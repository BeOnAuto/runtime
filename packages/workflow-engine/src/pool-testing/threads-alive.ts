import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';

import { Schema } from 'effect';

const threadStarts = 'worker_threads';

const decodeReport = Schema.decodeUnknownSync(Schema.Struct({ workers: Schema.Array(Schema.Unknown) }));

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ worker: Schema.instanceOf(EventEmitter) }));

const decodeThread = Schema.decodeUnknownSync(Schema.Struct({ threadId: Schema.Number }));

const ended = new Set<number>();

subscribe(threadStarts, (started) => {
  const { worker } = decodeStarted(started);
  const { threadId } = decodeThread(worker);
  worker.once('exit', () => {
    ended.add(threadId);
  });
});

export function threadsAlive(): number {
  return decodeReport(process.report.getReport()).workers.length;
}

export function threadEnded(thread: number): boolean {
  return ended.has(thread);
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
