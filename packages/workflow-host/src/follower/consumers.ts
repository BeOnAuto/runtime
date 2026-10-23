import type { PlaybookAddress, RecordedEvent } from '@on.auto/operations';
import { Data, type Effect } from 'effect';

import type { FollowedEvent } from './followed-events.ts';

export interface CallRecord {
  readonly playbook: PlaybookAddress;
  readonly playbookKey: string;
  readonly record: RecordedEvent;
}

export interface FollowedRecord extends CallRecord {
  readonly event: FollowedEvent;
}

export class DeliveryFailed extends Data.TaggedError('delivery_failed')<{ readonly detail: string }> {}

export interface Delivery {
  readonly key: string;
  readonly workflow: string;
  readonly deliver: Effect.Effect<void, DeliveryFailed>;
  readonly skipped: (detail: string) => Effect.Effect<void>;
}

interface Batch {
  readonly deliveries: readonly Delivery[];
  readonly through: string | undefined;
  readonly more: boolean;
}

export interface RecordConsumer<Followed = FollowedRecord> {
  readonly name: string;
  readonly skippedAfterSweeps: number;
  readonly batchOf: (followed: Followed, after: string | undefined, most: number) => Effect.Effect<Batch>;
}

export interface Consumer extends RecordConsumer {
  readonly types: readonly string[];
}

export interface BoundConsumer {
  readonly name: string;
  readonly skippedAfterSweeps: number;
  readonly batchOf: (after: string | undefined, most: number) => Effect.Effect<Batch>;
}

export function boundTo<Followed>(consumer: RecordConsumer<Followed>, followed: Followed): BoundConsumer {
  return {
    name: consumer.name,
    skippedAfterSweeps: consumer.skippedAfterSweeps,
    batchOf: (after, most) => consumer.batchOf(followed, after, most),
  };
}

export type Reading = BoundConsumer | 'unreadable';

export interface CallConsumer {
  readonly types: readonly string[];
  readonly read: (call: CallRecord) => Reading;
}

interface CallReader<Read> extends RecordConsumer<Read> {
  readonly types: readonly string[];
  readonly readOf: (call: CallRecord) => Read | undefined;
}

export function callConsumerOf<Read>(reader: CallReader<Read>): CallConsumer {
  return {
    types: reader.types,
    read: (call) => {
      const read = reader.readOf(call);
      return read === undefined ? 'unreadable' : boundTo(reader, read);
    },
  };
}

export const deliveriesOfARecordInAPass = 100;

export const deliverySweeps = 20;
