import { Option, Schema } from 'effect';

import { readySignal } from '../jobs/ready-signal.ts';
import { ProcessJobSchema, type ProcessAnswer } from './process-messages.ts';
import { valueOf, wireOf, type ProcessValue } from './process-values.ts';

export type ProcessHandler = (
  payload: ProcessValue,
  signal?: Readonly<AbortSignal>,
) => ProcessValue | Promise<ProcessValue>;

export type ProcessHandlers = Readonly<Record<string, ProcessHandler>>;

export interface ProcessHost {
  readonly send?: ((message: unknown) => boolean) | undefined;
  readonly on: (event: 'message', listener: (message: unknown) => void) => unknown;
}

const decodeJob = Schema.decodeUnknownOption(ProcessJobSchema);

const unreadableJob = 'The process could not read the job it was sent';

const unreadablePayload = 'The process could not read the payload of its job';

const unsendableAnswer = 'The process answered with what the pipe cannot carry';

function jobNamedIn(message: unknown): number {
  const job: unknown = Reflect.get(new Object(message), 'job');
  return typeof job === 'number' ? job : -1;
}

export function isAllocationFailure(error: unknown): boolean {
  return error instanceof RangeError && /allocation failed/u.test(error.message);
}

function handlerOf(handlers: ProcessHandlers, kind: string): ProcessHandler | undefined {
  return Object.hasOwn(handlers, kind) ? handlers[kind] : undefined;
}

async function answered(handler: ProcessHandler, job: number, payload: ProcessValue): Promise<ProcessAnswer> {
  try {
    const answer = wireOf(await handler(payload));
    return Option.isSome(answer) ? { job, answer: answer.value, keep: true } : { job, failed: unsendableAnswer };
  } catch (error) {
    return isAllocationFailure(error) ? { job, exhausted: 'memory' } : { job, failed: String(error) };
  }
}

function answerTo(message: unknown, handlers: ProcessHandlers): Promise<ProcessAnswer> {
  const envelope = decodeJob(message);
  if (Option.isNone(envelope)) {
    return Promise.resolve({ job: jobNamedIn(message), failed: unreadableJob });
  }
  const { job, kind, payload } = envelope.value;
  const handler = handlerOf(handlers, kind);
  if (handler === undefined) {
    return Promise.resolve({ job, failed: `This process serves no job of the kind ${kind}` });
  }
  return Option.match(valueOf(payload), {
    onNone: () => Promise.resolve<ProcessAnswer>({ job, failed: unreadablePayload }),
    onSome: (value) => answered(handler, job, value),
  });
}

export function serveProcessJobs(handlers: ProcessHandlers, host: ProcessHost): void {
  if (host.send === undefined) {
    return;
  }
  host.on('message', (message) => {
    void answerTo(message, handlers).then((answer) => host.send?.(answer));
  });
  host.send(readySignal);
}
