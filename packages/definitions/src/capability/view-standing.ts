import type { PlaybookAddress } from '@on.auto/operations';
import type { Effect, Schema } from 'effect';

interface KeptViewEvent {
  readonly id: string;
  readonly type: string;
  readonly time: string;
}

export interface KeptViewStall {
  readonly event: KeptViewEvent;
  readonly kind: string;
  readonly message: string;
  readonly line: number | null;
}

export interface KeptViewState {
  readonly version: number;
  readonly phase: 'waiting' | 'rebuilding' | 'live' | 'stalled' | 'out_of_reach';
  readonly view: Schema.Json;
  readonly checkpoint: string | null;
  readonly checkpointAt: string | null;
  readonly lastEvent: Omit<KeptViewEvent, 'type'> | null;
  readonly folded: number;
  readonly stall?: KeptViewStall;
}

export interface KeptViews {
  readonly viewOf: (playbook: PlaybookAddress, name: string) => Effect.Effect<KeptViewState | undefined>;
  readonly newestRecordAt: (playbook: PlaybookAddress) => Effect.Effect<string | undefined>;
  readonly viewAsOfRun: (
    playbook: PlaybookAddress,
    name: string,
    run: string,
  ) => Effect.Effect<KeptViewState | undefined>;
}

export function lagOf(newestAt: string | undefined, checkpointAt: string | null): number | undefined {
  if (newestAt === undefined || checkpointAt === null) {
    return undefined;
  }
  return Math.max(0, Date.parse(newestAt) - Date.parse(checkpointAt));
}

function stalledOf({ event, kind, message, line }: KeptViewStall): Schema.JsonObject {
  return { event: { id: event.id, type: event.type, time: event.time }, kind, error: message, line };
}

export function viewStandingOf(version: number, kept?: KeptViewState, newestAt?: string): Schema.JsonObject {
  const newest = { newest_record_at: newestAt ?? null };
  if (kept?.version !== version) {
    return { state: 'rebuilding', version, checkpoint: null, checkpoint_at: null, folded: 0, lag_ms: null, ...newest };
  }
  if (kept.phase === 'out_of_reach') {
    return { state: kept.phase, version };
  }
  return {
    state: kept.phase,
    version: kept.version,
    checkpoint: kept.checkpoint,
    checkpoint_at: kept.checkpointAt,
    folded: kept.folded,
    last_event: kept.lastEvent === null ? null : { id: kept.lastEvent.id, time: kept.lastEvent.time },
    lag_ms: lagOf(newestAt, kept.checkpointAt) ?? null,
    ...newest,
    ...(kept.stall === undefined ? {} : { stalled: stalledOf(kept.stall) }),
  };
}
