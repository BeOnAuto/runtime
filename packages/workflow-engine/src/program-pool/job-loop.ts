import { parentPort, workerData, type MessagePort } from 'node:worker_threads';

import { Option, Schema } from 'effect';

import type { FoldAnswerData } from '../folds/fold-answer.ts';
import { progressOf } from '../folds/fold-progress.ts';
import { instanceStock, type InstanceSource } from '../instances/instance-source.ts';
import { JobSchema, type JobAnswer, type JobEnvelope } from '../jobs/job-envelopes.ts';
import { keptFor, type JobHandlers, type Kept } from '../jobs/job-kit.ts';
import type { ProgramAnswerData } from '../jobs/program-answer.ts';
import { readySignal } from '../jobs/ready-signal.ts';
import { handedFile, handedSandboxOf, type HandedFile } from './handed-files.ts';

type ProgramEnvelope = Extract<JobEnvelope, { readonly kind: 'program' }>;

type FoldEnvelope = Extract<JobEnvelope, { readonly kind: 'fold' }>;

type CheckEnvelope = Extract<JobEnvelope, { readonly kind: 'check' }>;

interface Serving {
  readonly handlers: JobHandlers;
  readonly kept: Kept;
  readonly instances: InstanceSource;
}

const decodeJob = Schema.decodeUnknownOption(JobSchema);

const unreadable = { ran: 'unreadable' } as const;

function now(): number {
  return performance.timeOrigin + performance.now();
}

function keepsAfterProgram(answer: ProgramAnswerData): boolean {
  return answer.ran !== 'exhausted' || answer.limit !== 'deadline';
}

function keepsAfterFold(answer: FoldAnswerData): boolean {
  return answer.ran === 'folded' && answer.views.every(({ overtime }) => overtime === undefined);
}

async function programAnswer(
  { job, request }: ProgramEnvelope,
  { handlers, kept, instances }: Serving,
): Promise<JobAnswer> {
  if (handlers.program === undefined) {
    return { job, answer: unreadable, keep: false };
  }
  const instance = await instances(request.memoryBytes);
  const answer = handlers.program(request, {
    now,
    instance,
    check: kept.outputCheck(request.context),
  });
  return { job, answer, keep: keepsAfterProgram(answer) };
}

async function foldAnswer(
  { job, request, progress }: FoldEnvelope,
  { handlers, kept, instances }: Serving,
): Promise<JobAnswer> {
  if (handlers.fold === undefined) {
    return { job, answer: unreadable, keep: false };
  }
  const prepared = await Promise.all(request.views.map(() => instances(request.memoryBytes)));
  const { mark } = progressOf(progress);
  const answer = handlers.fold(request, {
    now,
    folding: mark,
    checkOf: kept.viewCheck,
    instances: prepared,
  });
  return { job, answer, keep: keepsAfterFold(answer) };
}

function checkAnswer({ job, request }: CheckEnvelope, { handlers }: Serving): JobAnswer {
  return handlers.check === undefined
    ? { job, answer: unreadable, keep: false }
    : { job, answer: handlers.check(request), keep: true };
}

function jobNamedIn(message: unknown): number {
  const job: unknown = Reflect.get(new Object(message), 'job');
  return typeof job === 'number' ? job : -1;
}

function answerTo(message: unknown, serving: Serving): Promise<JobAnswer> {
  const envelope = decodeJob(message);
  if (Option.isNone(envelope)) {
    return Promise.resolve({ job: jobNamedIn(message), answer: unreadable, keep: false });
  }
  const { value } = envelope;
  if (value.kind === 'program') {
    return programAnswer(value, serving);
  }
  return value.kind === 'fold' ? foldAnswer(value, serving) : Promise.resolve(checkAnswer(value, serving));
}

export type HandlersOf = (handed: HandedFile) => JobHandlers;

export type AnswerJob = (message: unknown) => Promise<JobAnswer>;

export function jobAnswererOf(handlersOf: HandlersOf, data: unknown): AnswerJob {
  const handlers = handlersOf((file) => handedFile(file, data));
  const serving: Serving = {
    handlers,
    kept: keptFor(handlers.checks),
    instances: instanceStock(handedSandboxOf(data)),
  };
  return (message) => answerTo(message, serving);
}

const servedHere: { claim?: ((handlersOf: HandlersOf) => void) | undefined } = {};

export function serveJobsWith(
  handlersOf: HandlersOf,
  port: MessagePort | null = parentPort,
  data: unknown = workerData,
): void {
  if (port === null) {
    servedHere.claim?.(handlersOf);
    return;
  }
  const answer = jobAnswererOf(handlersOf, data);
  port.on('message', (message: unknown) => {
    void answer(message).then((answered) => {
      port.postMessage(answered, []);
      return answered;
    });
  });
  port.postMessage(readySignal, []);
}

export async function handlersServedDuring(load: () => Promise<unknown>): Promise<HandlersOf> {
  const claiming = Promise.withResolvers<HandlersOf>();
  servedHere.claim = claiming.resolve;
  try {
    await load();
  } finally {
    delete servedHere.claim;
  }
  claiming.reject(new Error('The module serves no jobs'));
  return claiming.promise;
}

export function serveJobs(
  handlers: JobHandlers,
  port: MessagePort | null = parentPort,
  data: unknown = workerData,
): void {
  serveJobsWith(() => handlers, port, data);
}
