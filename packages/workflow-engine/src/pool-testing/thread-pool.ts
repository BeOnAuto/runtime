import { Function } from 'effect';

import { filterSandboxOf, machineSandboxOf } from '../instances/host-sandboxes.ts';
import { crashed } from '../jobs/job-endings.ts';
import type { PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import type { Job } from '../jobs/pool-job.ts';
import { handedData, handedSandboxOf } from '../program-pool/handed-files.ts';
import { handlersServedDuring, jobAnswererOf, type AnswerJob, type HandlersOf } from '../program-pool/job-loop.ts';
import {
  answerIn,
  type Envelope,
  type Served,
  type StartThread,
  type Thread,
  type ThreadHooks,
} from '../program-pool/pool-threads.ts';
import { programPoolOn } from '../program-pool/program-pool.ts';

const claimed = new Map<string, Promise<HandlersOf>>();

const importing = { done: Promise.resolve() };

/**
 * The address of a fresh instance of the worker module, which serves its jobs as it loads even where the test, or a
 * module it imports, loaded the module already.
 */
function freshInstanceOf(module: Readonly<URL>): string {
  return `${module.href}#served-on-the-thread-of-the-test`;
}

function handlersServedBy(module: Readonly<URL>): Promise<HandlersOf> {
  const known =
    claimed.get(module.href) ?? importing.done.then(() => handlersServedDuring(() => import(freshInstanceOf(module))));
  claimed.set(module.href, known);
  importing.done = known.then(Function.constVoid, Function.constVoid);
  return known;
}

function servedOnTheThread<Answer>(
  answering: AnswerJob | string,
  job: number,
  work: Job<Answer>,
): Promise<Served<Answer>> {
  return typeof answering === 'string'
    ? Promise.resolve({ ending: crashed(`The worker failed: ${answering}`), keep: false })
    : answering(work.envelope(job)).then((answer) => answerIn(answer, job, work));
}

function threadOn(start: Job<unknown>, settings: PoolSettings, hooks: ThreadHooks<Envelope>): Thread<Envelope> {
  const data = handedData(settings, start.module);
  const answering = handlersServedBy(start.module).then(
    (handlersOf): AnswerJob | string => jobAnswererOf(handlersOf, data),
    String,
  );
  const state = { jobs: 0, ended: false };
  const thread: Thread<Envelope> = {
    key: start.key,
    jobs: () => state.jobs,
    serve: async (job, work) => {
      state.jobs += 1;
      return servedOnTheThread(await answering, job, work);
    },
    rest: Function.constVoid,
    wake: Function.constVoid,
    end: () => {
      if (!state.ended) {
        state.ended = true;
        hooks.gone(thread);
      }
      return Promise.resolve();
    },
  };
  return thread;
}

function threadsOn(settings: PoolSettings): StartThread<Envelope> {
  return (start, hooks) => threadOn(start, settings, hooks);
}

/**
 * A program pool that serves its jobs on the thread of the caller: the worker module is imported here and its
 * handlers answer each job, so a test runs programs, folds and checks without starting a worker thread.
 */
export function threadPool(settings: PoolSettings): ProgramPool {
  const source = handedSandboxOf({ handed: settings.handed.sandbox, instances: settings.instances });
  return programPoolOn(settings, {
    threads: threadsOn(settings),
    evaluations: {
      evaluations: { machine: machineSandboxOf(source), filters: filterSandboxOf(source) },
      close: () => Promise.resolve(),
    },
  });
}
