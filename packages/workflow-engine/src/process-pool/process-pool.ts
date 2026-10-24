import { Option } from 'effect';

import { crashed, type Ending, type Stopped } from '../jobs/job-endings.ts';
import type { ModuleAddress } from '../jobs/pool-contract.ts';
import type { Job, Running } from '../jobs/pool-job.ts';
import { admitted, poolSlots, type PoolSlots } from '../program-pool/pool-slots.ts';
import { poolWorkers, type PoolWorkers, type RosterSettings } from '../program-pool/pool-workers.ts';
import { commandOf, limiterOn } from './memory-limit.ts';
import type { ProcessMessage } from './process-messages.ts';
import { processThreadOf } from './process-thread.ts';
import { valueOf, wireOf, type ProcessValue } from './process-values.ts';

export interface ProcessPoolSettings {
  readonly processes: number;
  readonly longJobs: number;
  readonly memoryBytes: number;
  readonly path: string | undefined;
  readonly idleMs?: number;
  readonly jobsPerProcess?: number;
}

export interface ProcessRequest {
  readonly module: ModuleAddress;
  readonly key: string;
  readonly kind: string;
  readonly payload: ProcessValue;
  readonly deadlineMs: number;
  readonly long?: boolean;
}

type StoppedEnding = 'timed_out' | 'out_of_memory' | 'busy' | 'cancelled' | 'closing';

export type ProcessEnding =
  | { readonly ended: 'answered'; readonly answer: ProcessValue }
  | { readonly ended: 'crashed'; readonly detail: string }
  | { readonly ended: StoppedEnding };

export type ProcessOutcome = ProcessEnding & { readonly milliseconds: number };

export interface ProcessPool {
  readonly processes: number;
  readonly longJobs: number;
  readonly memoryBytes: number;
  readonly limiter: string | undefined;
  readonly run: (request: ProcessRequest, signal?: Readonly<AbortSignal>) => Promise<ProcessOutcome>;
  readonly close: () => Promise<void>;
}

interface Answered {
  readonly ran: 'answered';
  readonly answer: ProcessValue;
}

interface Admission {
  readonly slots: PoolSlots;
  readonly longSlots: PoolSlots;
  readonly processes: PoolWorkers<ProcessMessage>;
}

const stoppedAs: Readonly<Record<Stopped, StoppedEnding>> = {
  deadline: 'timed_out',
  memory: 'out_of_memory',
  busy: 'busy',
  cancelled: 'cancelled',
  closing: 'closing',
};

const unsendablePayload = 'The payload holds what the pipe to a process cannot carry';

function answeredOf(answer: unknown): Option.Option<Answered> {
  return Option.map(valueOf(answer), (value): Answered => ({ ran: 'answered', answer: value }));
}

function jobOf(request: ProcessRequest, payload: unknown): Job<Answered, ProcessMessage> {
  const module = request.module();
  return {
    key: JSON.stringify([module.href, request.key]),
    module,
    envelope: (job) => ({ job, kind: request.kind, payload }),
    decode: answeredOf,
  };
}

function servedIn(
  { slots, longSlots, processes }: Admission,
  request: ProcessRequest,
  payload: unknown,
  running: Running,
): Promise<Ending<Answered>> {
  const { until, signal } = running;
  const job = jobOf(request, payload);
  const held = (): Running => ({ ...running, until: performance.now() + request.deadlineMs });
  const served = (): Promise<Ending<Answered>> => admitted(slots, until, signal, () => processes.evaluate(job, held()));
  return request.long === true ? admitted(longSlots, until, signal, served) : served();
}

function endingOf(ending: Ending<Answered>): ProcessEnding {
  if (ending.ran === 'answered') {
    return { ended: 'answered', answer: ending.answer };
  }
  return ending.ran === 'crashed' ? { ended: 'crashed', detail: ending.detail } : { ended: stoppedAs[ending.because] };
}

function rosterOf({ processes, idleMs, jobsPerProcess }: ProcessPoolSettings): RosterSettings {
  return {
    workers: processes,
    ...(idleMs === undefined ? {} : { idleMs }),
    ...(jobsPerProcess === undefined ? {} : { jobsPerWorker: jobsPerProcess }),
  };
}

export function processPool(settings: ProcessPoolSettings): ProcessPool {
  const limiter = limiterOn(settings.path);
  const command = commandOf(limiter, settings.memoryBytes);
  const admission: Admission = {
    slots: poolSlots(settings.processes),
    longSlots: poolSlots(settings.longJobs),
    processes: poolWorkers<ProcessMessage>(rosterOf(settings), (start, hooks) =>
      processThreadOf(start, command, hooks),
    ),
  };
  return {
    processes: settings.processes,
    longJobs: settings.longJobs,
    memoryBytes: settings.memoryBytes,
    limiter,
    run: async (request, signal) => {
      const started = performance.now();
      const running: Running = { until: started + request.deadlineMs, signal };
      const ending = await Option.match(wireOf(request.payload), {
        onNone: () => Promise.resolve(crashed(unsendablePayload)),
        onSome: (payload) => servedIn(admission, request, payload, running),
      });
      return { ...endingOf(ending), milliseconds: performance.now() - started };
    },
    close: async () => {
      admission.slots.close();
      admission.longSlots.close();
      await admission.processes.close();
    },
  };
}
