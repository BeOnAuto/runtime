import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Function, Option, Schema } from 'effect';

import { crashed, stopped, type Interrupted } from '../jobs/job-endings.ts';
import type { Job, Running } from '../jobs/pool-job.ts';
import { ReadySchema } from '../jobs/ready-signal.ts';
import { restingFor, type Served, type Thread, type ThreadHooks } from '../program-pool/pool-threads.ts';
import { ProcessAnswerSchema, type ProcessMessage } from './process-messages.ts';

export interface ProcessCommand {
  readonly command: string;
  readonly arguments: readonly string[];
}

type Signal = NodeJS.Signals;

type StoppedBy = 'deadline' | 'cancelled';

interface ProcessEvents {
  readonly answered: (message: unknown) => void;
  readonly failed: (error: Readonly<Error>) => void;
  readonly exited: (code: number | null, signal: Signal | null) => void;
}

interface Spawned {
  readonly started: () => boolean;
  readonly send: (message: ProcessMessage) => void;
  readonly kill: () => void;
  readonly hold: () => void;
  readonly release: () => void;
  readonly listen: (events: ProcessEvents) => void;
}

interface ProcessState {
  jobs: number;
  events?: ProcessEvents;
}

interface Watch<Answer> {
  readonly served: Promise<Served<Answer>>;
  readonly events: ProcessEvents;
  readonly done: () => void;
}

interface WatchParts {
  readonly closing: () => boolean;
  readonly kill: () => void;
}

interface Listening {
  stoppedBy?: StoppedBy;
  heard: (message: unknown) => void;
}

const decodeAnswer = Schema.decodeUnknownOption(ProcessAnswerSchema);

const isReady = Schema.is(ReadySchema);

const outOfMemorySignals: ReadonlySet<string> = new Set(['SIGABRT', 'SIGTRAP']);

const notAnAnswer = 'The process answered with something that is not an answer';

function diedOf(code: number | null, signal: Signal | null): Interrupted {
  if (signal !== null && outOfMemorySignals.has(signal)) {
    return stopped('memory');
  }
  return crashed(
    signal === null
      ? `The process ended with code ${String(code)} before it answered`
      : `The process ended by ${signal} before it answered`,
  );
}

function endedOf(code: number | null, signal: Signal | null, stoppedBy: StoppedBy | undefined): Interrupted {
  return stoppedBy !== undefined && signal === 'SIGKILL' ? stopped(stoppedBy) : diedOf(code, signal);
}

function answerIn<Answer>(message: unknown, job: number, { decode }: Job<Answer, ProcessMessage>): Served<Answer> {
  const reply = decodeAnswer(message);
  if (Option.isNone(reply)) {
    return { ending: crashed(notAnAnswer), keep: false };
  }
  const answer = reply.value;
  if (answer.job !== job) {
    return { ending: crashed(`The process answered job ${answer.job} while it ran job ${job}`), keep: false };
  }
  if ('failed' in answer) {
    return { ending: crashed(answer.failed), keep: false };
  }
  if ('exhausted' in answer) {
    return { ending: stopped(answer.exhausted), keep: false };
  }
  const { keep } = answer;
  return Option.match(decode(answer.answer), {
    onNone: (): Served<Answer> => ({ ending: crashed(notAnAnswer), keep: false }),
    onSome: (decoded) => ({ ending: decoded, keep }),
  });
}

function watchOf<Answer>(
  job: number,
  work: Job<Answer, ProcessMessage>,
  running: Running,
  { closing, kill }: WatchParts,
): Watch<Answer> {
  const { promise, resolve } = Promise.withResolvers<Served<Answer>>();
  const listening: Listening = {
    heard: (message) => {
      resolve(answerIn(message, job, work));
    },
  };
  const stopping = (why: StoppedBy): void => {
    listening.stoppedBy ??= why;
    listening.heard = Function.constVoid;
    kill();
  };
  const timer = setTimeout(() => {
    stopping('deadline');
  }, running.until - performance.now());
  const cancel = (): void => {
    stopping('cancelled');
  };
  running.signal?.addEventListener('abort', cancel, { once: true });
  return {
    served: promise,
    events: {
      answered: (message) => {
        listening.heard(message);
      },
      failed: (error) => {
        resolve({ ending: crashed(`The process failed: ${error.message}`), keep: false });
      },
      exited: (code, signal) => {
        resolve({ ending: closing() ? stopped('closing') : endedOf(code, signal, listening.stoppedBy), keep: false });
      },
    },
    done: () => {
      clearTimeout(timer);
      running.signal?.removeEventListener('abort', cancel);
    },
  };
}

function spawnedOf({ command, arguments: given }: ProcessCommand, module: Readonly<URL>): Spawned {
  const child = spawn(command, [...given, fileURLToPath(module.href)], {
    env: {},
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'json',
  });
  return {
    started: () => child.pid !== undefined,
    send: (message) => {
      child.send(message);
    },
    kill: () => {
      child.kill('SIGKILL');
    },
    hold: () => {
      child.ref();
      child.channel?.ref();
    },
    release: () => {
      child.unref();
      child.channel?.unref();
    },
    listen: ({ answered, failed, exited }) => {
      child.on('message', answered).on('error', failed).once('exit', exited);
    },
  };
}

function heardBy(
  spawned: Spawned,
  current: () => ProcessEvents | undefined,
  {
    ready,
    troubled,
    gone,
  }: { readonly ready: () => void; readonly troubled: () => void; readonly gone: ProcessEvents['exited'] },
): ProcessEvents {
  return {
    answered: (message) => {
      const events = current();
      if (isReady(message)) {
        ready();
      } else if (events === undefined) {
        troubled();
      } else {
        events.answered(message);
      }
    },
    failed: (error) => {
      current()?.failed(error);
      if (!spawned.started()) {
        gone(null, null);
      }
    },
    exited: gone,
  };
}

function restingOn(spawned: Spawned, exited: Promise<void>): Pick<Thread<ProcessMessage>, 'rest' | 'wake' | 'end'> {
  const resting: { timer: ReturnType<typeof setTimeout> | undefined } = { timer: undefined };
  return {
    rest: (idleMs, tired) => {
      spawned.release();
      resting.timer = restingFor(idleMs, tired);
    },
    wake: () => {
      clearTimeout(resting.timer);
      spawned.hold();
    },
    end: () => {
      clearTimeout(resting.timer);
      spawned.hold();
      spawned.kill();
      return exited;
    },
  };
}

export function processThreadOf(
  start: Job<unknown, ProcessMessage>,
  command: ProcessCommand,
  hooks: ThreadHooks<ProcessMessage>,
): Thread<ProcessMessage> {
  const spawned = spawnedOf(command, start.module);
  const state: ProcessState = { jobs: 0 };
  const loading = Promise.withResolvers<boolean>();
  const exited = Promise.withResolvers<void>();
  const thread: Thread<ProcessMessage> = {
    key: start.key,
    jobs: () => state.jobs,
    serve: async (job, work, running) => {
      state.jobs += 1;
      const watch = watchOf(job, work, running, { closing: hooks.closing, kill: spawned.kill });
      state.events = watch.events;
      void loading.promise.then((ready) => {
        if (ready) {
          spawned.send(work.envelope(job));
        }
        return ready;
      });
      const served = await watch.served;
      watch.done();
      delete state.events;
      return served;
    },
    ...restingOn(spawned, exited.promise),
  };
  const gone = (code: number | null, signal: Signal | null): void => {
    loading.resolve(false);
    hooks.gone(thread);
    exited.resolve();
    state.events?.exited(code, signal);
  };
  const ready = (): void => {
    loading.resolve(true);
  };
  const troubled = (): void => {
    hooks.troubled(thread);
  };
  spawned.listen(heardBy(spawned, () => state.events, { ready, troubled, gone }));
  return thread;
}
