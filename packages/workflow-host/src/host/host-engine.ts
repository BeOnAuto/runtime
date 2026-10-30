import type { Conflict } from '@on.auto/operations';
import {
  runCacheBounds,
  runCacheOf,
  workflowEngineOf,
  type MachineOptions,
  type RunCacheBounds,
  type RunInput,
  type RunLogStore,
  type Submission,
  type WorkflowEngine,
} from '@on.auto/workflow-engine';
import { Effect, type Context } from 'effect';

import { hostExecutor, type ExecutorParts, type HostExecutor, type Perform } from '../calls/host-executor.ts';
import type { HostClock } from '../loop/host-clock.ts';
import type { ReactionOptions } from '../reactions/reaction-options.ts';
import { reactionPortsOn, type ReactionPorts } from '../reactions/reaction-ports.ts';
import { runAttributesOf } from '../runs/run-spans.ts';
import { sqlTimers, type TimerTable } from '../timers/sql-timers.ts';
import { hostPortsOn, type PortParts } from './host-ports.ts';

export interface EngineOptions extends Pick<PortParts, 'settle' | 'reports'> {
  readonly machine: MachineOptions;
  readonly perform: Perform;
  readonly mostCallsAtOnce: number;
  readonly clock: HostClock;
  readonly cacheBounds?: RunCacheBounds;
  readonly reactions: ReactionOptions;
  readonly context?: Context.Context<never> | undefined;
}

export interface HostEngine {
  readonly engine: WorkflowEngine;
  readonly runStore: RunLogStore;
  readonly timers: TimerTable;
  readonly executor: HostExecutor;
  readonly reacting: ReactionPorts;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
}

export type WaitingCalls = Pick<ExecutorParts, 'mostOpen' | 'childOf' | 'childAnswerOf' | 'cancelChild'>;

export function hostEngineOn(
  database: ExecutorParts['database'],
  options: EngineOptions,
  waiting: WaitingCalls,
  armed: (dueAt: number) => void,
): HostEngine {
  const { reports, clock } = options;
  const timers = sqlTimers(database, armed);
  const submitted = (input: RunInput): Effect.Effect<Submission, Conflict> =>
    Effect.uninterruptible(engine.submit(input)).pipe(
      Effect.tap(({ outcome, version }: Submission) =>
        Effect.annotateCurrentSpan({ 'auto.on.submission': outcome, 'auto.on.version': version }),
      ),
      Effect.withSpan(input.kind, { attributes: runAttributesOf(input.runId) }),
    );
  const executor = hostExecutor({
    database,
    perform: options.perform,
    deliver: (key, result) => submitted({ kind: 'call_answered', runId: key.runId, at: clock.now(), key, result }),
    trouble: reports.trouble,
    mostAtOnce: options.mostCallsAtOnce,
    now: clock.now,
    context: options.context,
    ...waiting,
  });
  const reacting = reactionPortsOn(database, options.reactions, clock.now);
  const ports = hostPortsOn(database, {
    settle: options.settle,
    reports,
    timers: timers.timers,
    executor: executor.executor,
    listeners: reacting.listeners,
    emitter: reacting.emitter,
    now: clock.now,
  });
  const engine = workflowEngineOf(ports, options.machine, runCacheOf(options.cacheBounds ?? runCacheBounds));
  return { engine, runStore: ports.runStore, timers, executor, reacting, submitted };
}
