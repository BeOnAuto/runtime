import { Worker, type WorkerOptions } from 'node:worker_threads';

import { Option, Schema } from 'effect';

import { crashed, stopped, type Ending, type Interrupted } from '../jobs/job-endings.ts';
import { JobAnswerSchema, type JobSchema } from '../jobs/job-envelopes.ts';
import type { PoolSettings } from '../jobs/pool-contract.ts';
import type { Job, Running } from '../jobs/pool-job.ts';
import { ReadySchema } from '../jobs/ready-signal.ts';
import { handedTo } from './handed-files.ts';

export const workerStackMegabytes = 64;

export interface Served<Answer> {
  readonly ending: Ending<Answer>;
  readonly keep: boolean;
}

export interface Thread<Message> {
  readonly key: string;
  readonly jobs: () => number;
  readonly serve: <Answer>(job: number, work: Job<Answer, Message>, running: Running) => Promise<Served<Answer>>;
  readonly rest: (idleMs: number, tired: () => void) => void;
  readonly wake: () => void;
  readonly end: () => Promise<unknown>;
}

export interface ThreadHooks<Message> {
  readonly closing: () => boolean;
  readonly troubled: (thread: Thread<Message>) => void;
  readonly gone: (thread: Thread<Message>) => void;
}

export type StartThread<Message> = (work: Job<unknown, Message>, hooks: ThreadHooks<Message>) => Thread<Message>;

type Envelope = typeof JobSchema.Encoded;

interface ThreadEvents {
  readonly answered: (message: unknown) => void;
  readonly failed: (error: unknown) => void;
  readonly exited: (code: number) => void;
}

interface ThreadState {
  jobs: number;
  events?: ThreadEvents;
  resting: ReturnType<typeof setTimeout> | undefined;
  ended?: Promise<number>;
}

interface Watch<Answer> {
  readonly served: Promise<Served<Answer>>;
  readonly events: ThreadEvents;
  readonly done: () => void;
}

type Start = 'ready' | 'gone' | Interrupted;

interface Serving {
  readonly loaded: Promise<boolean>;
  readonly served: <Answer>(job: number, work: Job<Answer>, running: Running) => Promise<Served<Answer>>;
  readonly closing: () => boolean;
}

const decodeJobAnswer = Schema.decodeUnknownOption(JobAnswerSchema);

const isReady = Schema.is(ReadySchema);

const outOfMemory = 'ERR_WORKER_OUT_OF_MEMORY';

const notAnAnswer = 'The worker answered with something that is not an answer';

function failedWith(error: unknown): Interrupted {
  const failure = new Object(error);
  return Reflect.get(failure, 'code') === outOfMemory
    ? stopped('memory')
    : crashed(`The worker failed: ${String(Reflect.get(failure, 'message'))}`);
}

function answerIn<Answer>(message: unknown, job: number, { decode }: Job<Answer>): Served<Answer> {
  const reply = decodeJobAnswer(message);
  if (Option.isNone(reply)) {
    return { ending: crashed(notAnAnswer), keep: false };
  }
  if (reply.value.job !== job) {
    return { ending: crashed(`The worker answered job ${reply.value.job} while it ran job ${job}`), keep: false };
  }
  return Option.match(decode(reply.value.answer), {
    onNone: (): Served<Answer> => ({ ending: crashed(notAnAnswer), keep: false }),
    onSome: (answer) => ({ ending: answer, keep: reply.value.keep }),
  });
}

function watchOf<Answer>(job: number, work: Job<Answer>, running: Running, closing: () => boolean): Watch<Answer> {
  const { promise, resolve } = Promise.withResolvers<Served<Answer>>();
  const ended = (ending: Ending<Answer>): void => {
    resolve({ ending, keep: false });
  };
  const timer = setTimeout(() => {
    ended(stopped('deadline'));
  }, running.until - performance.now());
  const cancel = (): void => {
    ended(stopped('cancelled'));
  };
  running.signal?.addEventListener('abort', cancel, { once: true });
  return {
    served: promise,
    events: {
      answered: (message) => {
        resolve(answerIn(message, job, work));
      },
      failed: (error) => {
        ended(failedWith(error));
      },
      exited: (code) => {
        ended(closing() ? stopped('closing') : crashed(`The worker ended with code ${code} before it answered`));
      },
    },
    done: () => {
      clearTimeout(timer);
      running.signal?.removeEventListener('abort', cancel);
    },
  };
}

async function startWithin(loaded: Promise<boolean>, running: Running): Promise<Start> {
  const { promise, resolve } = Promise.withResolvers<Start>();
  const timer = setTimeout(() => {
    resolve(stopped('busy'));
  }, running.until - performance.now());
  const cancel = (): void => {
    resolve(stopped('cancelled'));
  };
  running.signal?.addEventListener('abort', cancel, { once: true });
  void loaded.then((ready) => {
    resolve(ready ? 'ready' : 'gone');
    return ready;
  });
  const start = await promise;
  clearTimeout(timer);
  running.signal?.removeEventListener('abort', cancel);
  return start;
}

function goneBeforeReady<Answer>(closing: boolean): Served<Answer> {
  return { ending: closing ? stopped('closing') : crashed('The worker ended before it was ready'), keep: false };
}

async function servedOnceReady<Answer>(serving: Serving, job: number, work: Job<Answer>, running: Running) {
  if (running.afterReady === undefined) {
    return serving.served(job, work, running);
  }
  const start = await startWithin(serving.loaded, running);
  if (start === 'ready') {
    return serving.served(job, work, { until: performance.now() + running.afterReady, signal: running.signal });
  }
  return start === 'gone' ? goneBeforeReady<Answer>(serving.closing()) : { ending: start, keep: true };
}

export function restingFor(idleMs: number, tired: () => void): ReturnType<typeof setTimeout> | undefined {
  return Number.isFinite(idleMs) ? setTimeout(tired, idleMs).unref() : undefined;
}

function readyOr(ready: (loaded: boolean) => void, answered: (message: unknown) => void): (message: unknown) => void {
  return (message) => {
    if (isReady(message)) {
      ready(true);
    } else {
      answered(message);
    }
  };
}

function routed(current: () => ThreadEvents | undefined, troubled: () => void): ThreadEvents {
  return {
    answered: (message) => {
      const events = current();
      if (events === undefined) {
        troubled();
      } else {
        events.answered(message);
      }
    },
    failed: (error) => {
      const events = current();
      if (events === undefined) {
        troubled();
      } else {
        events.failed(error);
      }
    },
    exited: (code) => {
      current()?.exited(code);
    },
  };
}

export function workerOptions(settings: PoolSettings): WorkerOptions {
  return {
    resourceLimits: { maxOldGenerationSizeMb: settings.heapMegabytes, stackSizeMb: workerStackMegabytes },
    env: { ...settings.environment },
    execArgv: [],
  };
}

function workerStarting(module: Readonly<URL>, settings: PoolSettings): Worker {
  return new Worker(module, { ...workerOptions(settings), workerData: { handed: handedTo(settings.handed, module) } });
}

function threadOf(start: Job<unknown>, settings: PoolSettings, hooks: ThreadHooks<Envelope>): Thread<Envelope> {
  const worker = workerStarting(start.module, settings);
  const state: ThreadState = { jobs: 0, resting: undefined };
  const loading = Promise.withResolvers<boolean>();
  const served = async <Answer>(job: number, work: Job<Answer>, running: Running): Promise<Served<Answer>> => {
    state.jobs += 1;
    const watch = watchOf(job, work, running, hooks.closing);
    state.events = watch.events;
    worker.postMessage(work.envelope(job), []);
    const answer = await watch.served;
    watch.done();
    delete state.events;
    return answer;
  };
  const serving: Serving = { loaded: loading.promise, served, closing: hooks.closing };
  const thread: Thread<Envelope> = {
    key: start.key,
    jobs: () => state.jobs,
    serve: (job, work, running) => servedOnceReady(serving, job, work, running),
    rest: (idleMs, tired) => {
      worker.unref();
      state.resting = restingFor(idleMs, tired);
    },
    wake: () => {
      clearTimeout(state.resting);
      worker.ref();
    },
    end: () => {
      clearTimeout(state.resting);
      state.ended ??= worker.terminate();
      return state.ended;
    },
  };
  const route = routed(
    () => state.events,
    () => {
      hooks.troubled(thread);
    },
  );
  worker
    .on('message', readyOr(loading.resolve, route.answered))
    .on('error', route.failed)
    .on('exit', (code: number) => {
      loading.resolve(false);
      hooks.gone(thread);
      route.exited(code);
    });
  return thread;
}

export function workerThreadsOf(settings: PoolSettings): StartThread<Envelope> {
  return (start, hooks) => threadOf(start, settings, hooks);
}
