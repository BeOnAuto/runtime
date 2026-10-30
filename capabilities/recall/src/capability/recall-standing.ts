import type { Standing } from '@on.auto/definitions';
import type { KeptView, ViewsPort, ViewStall } from '@on.auto/workflow-host';
import { Effect, type Schema } from 'effect';

import { lagOf } from '../run/view-words.ts';

function stalledOf({ event, kind, message, line }: ViewStall): Schema.JsonObject {
  return { event: { id: event.id, type: event.type, time: event.time }, kind, error: message, line };
}

function standingOf(version: number, kept: KeptView | undefined, newestAt: string | undefined): Schema.JsonObject {
  const newest = { newest_record_at: newestAt ?? null };
  if (kept?.version !== version) {
    return { state: 'rebuilding', version, checkpoint: null, checkpoint_at: null, folded: 0, lag_ms: null, ...newest };
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

export function recallStanding(views: ViewsPort): Standing {
  return ({ org, playbook, name, version, status }) =>
    status === 'retired'
      ? Effect.undefined
      : Effect.all([views.viewOf({ org, playbook }, name), views.newestRecordAt({ org, playbook })]).pipe(
          Effect.map(([kept, newestAt]: readonly [KeptView | undefined, string | undefined]) =>
            standingOf(version, kept, newestAt),
          ),
        );
}
