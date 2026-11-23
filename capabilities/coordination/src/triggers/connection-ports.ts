import type { TriggerRead } from '@on.auto/definitions/trigger-reads';
import type { PlaybookAddress } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { ToolsOffered } from './trigger-reads.ts';

export interface EventTypeReported {
  readonly type: string;
  readonly title: string;
  readonly subject?: { readonly title: string; readonly required: boolean };
}

export interface Subscribes {
  readonly topic: string;
  readonly mostTopics: number;
}

export type Hearing =
  | { readonly kind: 'heard'; readonly subscribes?: Subscribes }
  | { readonly kind: 'lacking'; readonly label: string }
  | { readonly kind: 'not_heard' };

interface ListenedElsewhere {
  readonly workflow: string;
  readonly type: string;
  readonly subject?: string;
  readonly read?: TriggerRead;
}

export interface ConnectionReporting {
  readonly status: 'pending' | 'connected' | 'broken';
  readonly types: readonly EventTypeReported[];
  readonly hearing: (type: string, subject: string | undefined) => Effect.Effect<Hearing>;
  readonly reading: (type: string, read: TriggerRead) => Effect.Effect<Hearing>;
  readonly tools: Effect.Effect<ToolsOffered>;
  readonly listenedBy: readonly ListenedElsewhere[];
}

export interface StandingAsked {
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
  readonly read?: TriggerRead;
  readonly paused: boolean;
}

export interface TriggerStanding {
  readonly event?: string;
  readonly subjectName?: string;
  readonly speed: 'instant' | 'polling';
  readonly pollingIntervalSeconds?: number;
  readonly listening: boolean;
  readonly notListeningBecause: { readonly kind: string; readonly detail: string } | null;
  readonly needsReconnecting: boolean;
}

export interface ConnectionEvents {
  readonly reportingOf: (
    playbook: PlaybookAddress,
    connection: string,
  ) => Effect.Effect<ConnectionReporting | undefined>;
  readonly standingOf: (playbook: PlaybookAddress, asked: StandingAsked) => Effect.Effect<TriggerStanding>;
}

export interface Listening {
  readonly connection: string;
  readonly reference: string;
  readonly type: string;
  readonly subject?: string;
  readonly read?: TriggerRead;
}
