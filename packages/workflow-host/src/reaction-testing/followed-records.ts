import type { Json } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { FollowedRecord } from '../follower/consumers.ts';
import type { FollowedEvent } from '../follower/followed-events.ts';
import type { RefuseReaction } from '../reactions/refusals.ts';

export interface SaidRefusals {
  readonly refusals: RefuseReaction;
  readonly said: () => readonly string[];
  readonly say: (line: string) => Effect.Effect<void>;
}

const time = '2026-10-01T09:00:00.000Z';

export function followedRecordOf(data: Json, about: Partial<FollowedEvent> = {}): FollowedRecord {
  return {
    playbook: { org: 'acme', playbook: 'alpha' },
    playbookKey: 'playbook/acme/alpha/',
    record: {
      id: 'record-1',
      cursor: 'c1',
      causationId: null,
      correlationId: null,
      stream: 'events/e1',
      version: 1,
      globalPosition: 1,
      type: 'event_published',
      data: {},
      context: { at: time, by: 'acme-admin' },
      recordedAt: time,
    },
    event: {
      event: { specversion: '1.0', id: 'e1', source: '/acme', type: 'go', time, data },
      depth: 1,
      emitter: undefined,
      ownedBy: [],
      topRun: undefined,
      ...about,
    },
  };
}

export function saidRefusals(): SaidRefusals {
  const said: string[] = [];
  const say = (line: string) =>
    Effect.sync(() => {
      said.push(line);
    });
  return {
    refusals: { refuse: (_playbookKey, { workflow }, reason) => say(`${workflow}: ${reason}`) },
    said: () => said,
    say,
  };
}
