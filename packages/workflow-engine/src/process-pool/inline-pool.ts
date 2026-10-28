import { poolSlots, type PoolSlots } from '../program-pool/pool-slots.ts';
import { isAllocationFailure, type ProcessHandler, type ProcessHandlers } from './process-loop.ts';
import type { ProcessEnding, ProcessOutcome } from './process-pool.ts';
import type { ProcessValue } from './process-values.ts';

export interface InlinePoolSettings {
  readonly jobs: number;
  readonly longJobs: number;
  readonly handlers: ProcessHandlers;
}

export interface InlineRequest {
  readonly kind: string;
  readonly payload: ProcessValue;
  readonly deadlineMs: number;
  readonly long?: boolean;
}

export interface InlinePool {
  readonly jobs: number;
  readonly longJobs: number;
  readonly run: (request: InlineRequest, signal?: Readonly<AbortSignal>) => Promise<ProcessOutcome>;
  readonly close: () => void;
}

interface Lanes {
  readonly slots: PoolSlots;
  readonly longSlots: PoolSlots;
}

interface Admitted {
  readonly release: () => void;
}

interface Refused {
  readonly ended: 'busy' | 'cancelled' | 'closing';
}

function handlerOf(handlers: ProcessHandlers, kind: string): ProcessHandler | undefined {
  return Object.hasOwn(handlers, kind) ? handlers[kind] : undefined;
}

async function admittedTo(
  slots: PoolSlots,
  until: number,
  signal: Readonly<AbortSignal> | undefined,
): Promise<Admitted | Refused> {
  const admission = await slots.admit(until, signal);
  return admission === 'admitted'
    ? {
        release: () => {
          slots.release();
        },
      }
    : { ended: admission };
}

async function admittedIn(
  { slots, longSlots }: Lanes,
  request: InlineRequest,
  until: number,
  signal: Readonly<AbortSignal> | undefined,
): Promise<Admitted | Refused> {
  if (request.long !== true) {
    return admittedTo(slots, until, signal);
  }
  const long = await admittedTo(longSlots, until, signal);
  if ('ended' in long) {
    return long;
  }
  const lane = await admittedTo(slots, until, signal);
  if ('ended' in lane) {
    long.release();
    return lane;
  }
  return {
    release: () => {
      lane.release();
      long.release();
    },
  };
}

function answeredBy(work: Promise<ProcessValue>): Promise<ProcessEnding> {
  return work.then(
    (answer): ProcessEnding => ({ ended: 'answered', answer }),
    (error: unknown): ProcessEnding =>
      isAllocationFailure(error) ? { ended: 'out_of_memory' } : { ended: 'crashed', detail: String(error) },
  );
}

function endedWithin(deadlineMs: number, signal: Readonly<AbortSignal> | undefined, stop: () => void) {
  const { promise, resolve } = Promise.withResolvers<ProcessEnding>();
  const timer = setTimeout(() => {
    resolve({ ended: 'timed_out' });
  }, deadlineMs);
  const cancelled = () => {
    resolve({ ended: 'cancelled' });
  };
  signal?.addEventListener('abort', cancelled, { once: true });
  return {
    stopped: promise,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      stop();
    },
  };
}

function served(
  handler: ProcessHandler,
  request: InlineRequest,
  signal: Readonly<AbortSignal> | undefined,
  admitted: Admitted,
): Promise<ProcessEnding> {
  const controller = new AbortController();
  const work = Promise.resolve().then(() => handler(request.payload, controller.signal));
  void work.then(admitted.release, admitted.release);
  const watch = endedWithin(request.deadlineMs, signal, () => {
    controller.abort();
  });
  return Promise.race([answeredBy(work), watch.stopped]).finally(watch.done);
}

async function endingOf(
  lanes: Lanes,
  handlers: ProcessHandlers,
  request: InlineRequest,
  signal: Readonly<AbortSignal> | undefined,
): Promise<ProcessEnding> {
  const handler = handlerOf(handlers, request.kind);
  if (handler === undefined) {
    return { ended: 'crashed', detail: `This pool serves no job of the kind ${request.kind}` };
  }
  const admitted = await admittedIn(lanes, request, performance.now() + request.deadlineMs, signal);
  if ('ended' in admitted) {
    return admitted;
  }
  if (signal?.aborted === true) {
    admitted.release();
    return { ended: 'cancelled' };
  }
  return served(handler, request, signal, admitted);
}

export function inlinePool({ jobs, longJobs, handlers }: InlinePoolSettings): InlinePool {
  const lanes: Lanes = { slots: poolSlots(jobs), longSlots: poolSlots(longJobs) };
  return {
    jobs,
    longJobs,
    run: async (request, signal) => {
      const started = performance.now();
      const ending = await endingOf(lanes, handlers, request, signal);
      return { ...ending, milliseconds: performance.now() - started };
    },
    close: () => {
      lanes.slots.close();
      lanes.longSlots.close();
    },
  };
}
