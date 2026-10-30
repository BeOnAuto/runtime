import { Schema, Struct } from 'effect';

import { CheckAnswerSchema, type CheckAnswer } from '../jobs/check-messages.ts';
import { foldJobOf } from '../jobs/fold-job.ts';
import type { CheckRequest, PoolSettings, ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import type { Job } from '../jobs/pool-job.ts';
import { ProgramAnswerSchema, type ProgramAnswer } from '../jobs/program-messages.ts';
import { poolEvaluationsOf } from './evaluation-thread.ts';
import { admitted, poolSlots } from './pool-slots.ts';
import { workerThreadsOf } from './pool-threads.ts';
import { poolWorkers } from './pool-workers.ts';

export const checkPermits = 1;

export const mostCheckStartMs = 10_000;

function programWorker(): URL {
  return new URL('../workers/program-worker.ts', import.meta.url);
}

function foldWorker(): URL {
  return new URL('../workers/fold-worker.ts', import.meta.url);
}

function evaluationWorker(): URL {
  return new URL('../workers/evaluation-worker.ts', import.meta.url);
}

const decodeProgramAnswer = Schema.decodeUnknownOption(ProgramAnswerSchema);

const decodeCheckAnswer = Schema.decodeUnknownOption(CheckAnswerSchema);

function programJob(module: Readonly<URL>, request: ProgramRequest, until: number): Job<ProgramAnswer> {
  const job = {
    ...Struct.pick(request, ['source', 'entry', 'moment', 'budget', 'memoryBytes', 'stackBytes', 'mostOutputBytes']),
    arguments: request.arguments.map((argument) => JSON.stringify(argument)),
    deadlineAt: performance.timeOrigin + until,
    context: request.context ?? null,
  };
  return {
    key: module.href,
    module,
    envelope: (id) => ({ job: id, kind: 'program', request: job }),
    decode: decodeProgramAnswer,
  };
}

function checkJob(module: Readonly<URL>, request: CheckRequest): Job<CheckAnswer> {
  const job = Struct.omit(request, ['deadlineMs', 'worker']);
  return {
    key: module.href,
    module,
    envelope: (id) => ({ job: id, kind: 'check', request: job }),
    decode: decodeCheckAnswer,
  };
}

export function programPool(settings: PoolSettings): ProgramPool {
  const slots = poolSlots(settings.workers);
  const checkSlots = poolSlots(checkPermits);
  const workers = poolWorkers(settings, workerThreadsOf(settings));
  const checkers = poolWorkers(
    { ...settings, workers: checkPermits, idleMs: Number.POSITIVE_INFINITY },
    workerThreadsOf(settings),
  );
  const evaluations = poolEvaluationsOf(settings.evaluationWorker ?? evaluationWorker, settings);
  return {
    workers: settings.workers,
    heapMegabytes: settings.heapMegabytes,
    run: async (request, signal) => {
      const started = performance.now();
      const until = started + request.deadlineMs;
      const module = (settings.worker ?? request.worker ?? programWorker)();
      const ending = await admitted(slots, until, signal, () =>
        workers.evaluate(programJob(module, request, until), { until, signal }),
      );
      return { ...ending, milliseconds: performance.now() - started };
    },
    fold: async (request, signal) => {
      const started = performance.now();
      const job = foldJobOf((settings.foldWorker ?? request.worker ?? foldWorker)(), workers.evaluate, request, signal);
      const ending = await admitted(slots, started + job.waitMs, signal, job.run);
      return { ...ending, milliseconds: performance.now() - started };
    },
    check: async (request, signal) => {
      const started = performance.now();
      const ending = await admitted(checkSlots, started + request.deadlineMs, signal, () =>
        checkers.evaluate(checkJob(request.worker(), request), {
          until: performance.now() + (settings.checkStartMs ?? mostCheckStartMs),
          afterReady: request.deadlineMs,
          signal,
        }),
      );
      return { ...ending, milliseconds: performance.now() - started };
    },
    evaluations: evaluations.evaluations,
    close: async () => {
      slots.close();
      checkSlots.close();
      await Promise.all([workers.close(), checkers.close(), evaluations.close()]);
    },
  };
}
