import { Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { Consumer } from '../follower/consumers.ts';
import { startLoop } from '../loop/host-loop.ts';
import { hostWakeUp } from '../loop/host-wake-up.ts';
import type { ProjectorSettings } from '../projector/projector-settings.ts';
import { startProjector } from '../projector/projector.ts';
import { startReacting } from '../reactions/host-reactions.ts';
import { closeHostParts, openHostParts, type HostParts, type PartsOptions } from './host-parts.ts';
import type { WorkflowStore } from './workflow-store.ts';

export interface ServingOptions extends PartsOptions {
  readonly consumers?: readonly Consumer[];
  readonly projector?: ProjectorSettings;
}

export interface Serving {
  readonly parts: HostParts;
  readonly stopReacting: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

function followerOf(database: HostDatabase, options: ServingOptions, parts: HostParts) {
  return startReacting(
    {
      database,
      submitted: parts.submitted,
      clock: options.clock,
      sweepEveryMs: options.sweepEveryMs,
      reports: options.reports,
      context: options.context,
    },
    options.reactions,
    parts.reacting,
    { consumers: options.consumers ?? [], calls: parts.calls },
  );
}

export function startServing(store: WorkflowStore, options: ServingOptions): Serving {
  const { database } = store;
  const alarm: { armed: (dueAt: number) => void } = { armed: Function.constVoid };
  const parts = openHostParts(store, options, (dueAt) => {
    alarm.armed(dueAt);
  });
  const loop = startLoop(parts, (signal) => hostWakeUp(parts, signal));
  alarm.armed = loop.armed;
  const follower = followerOf(database, options, parts);
  const projector =
    options.projector === undefined
      ? undefined
      : startProjector({
          database,
          settings: options.projector,
          reports: options.reports,
          clock: options.clock,
          sweepEveryMs: options.sweepEveryMs,
          context: options.context,
        });
  return {
    parts,
    stopReacting: follower.stop,
    stop: async () => {
      await follower.stop();
      await loop.stop();
      await projector?.stop();
      await closeHostParts(parts);
    },
  };
}
