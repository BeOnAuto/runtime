import { ActedContextSchema, factOf } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { SignedSchema } from '../licensing/signed-answers.ts';

const AllocationReceivedSchema = Schema.Struct({
  id: Schema.String,
  installation: Schema.String,
  credits: Schema.Int,
  issued_at: Schema.String,
  refresh_by: Schema.String,
  actions: Schema.Int,
  allocation: SignedSchema,
});

const OfflineReportSchema = Schema.Struct({
  allocation: Schema.String,
  installation: Schema.String,
  sequence: Schema.Int,
  spent: Schema.Int,
  at: Schema.String,
});

export const AllocationEventSchema = Schema.Union([
  factOf('allocation_received', AllocationReceivedSchema, ActedContextSchema),
  factOf(
    'allocation_refreshed',
    Schema.Struct({ id: Schema.String, refresh_by: Schema.String, allocation: SignedSchema }),
    ActedContextSchema,
  ),
  factOf('allocation_withdrawn', Schema.Struct({ id: Schema.String, detail: Schema.String }), ActedContextSchema),
  factOf('allocation_reported', OfflineReportSchema, ActedContextSchema),
]);

export type AllocationRecord = typeof AllocationReceivedSchema.Type;

export type OfflineReport = typeof OfflineReportSchema.Type;

type AllocationEvent = typeof AllocationEventSchema.Type;

export interface Allocation {
  readonly id: string;
  readonly installation: string;
  readonly credits: number;
  readonly refresh_by: string;
  readonly actions: number;
  readonly sequence: number;
  readonly spent: number;
  readonly withdrawn: string | undefined;
}

function received({ id, installation, credits, refresh_by: refreshBy, actions }: AllocationRecord): Allocation {
  return { id, installation, credits, refresh_by: refreshBy, actions, sequence: 0, spent: 0, withdrawn: undefined };
}

function changed(allocation: Allocation | undefined, change: Partial<Allocation>): Allocation | undefined {
  return Option.getOrUndefined(
    Option.map(Option.fromNullishOr(allocation), (standing) => ({ ...standing, ...change })),
  );
}

export function allocationAfter(allocation: Allocation | undefined, event: AllocationEvent): Allocation | undefined {
  if (event.type === 'allocation_received') return received(event.data);
  if (event.type === 'allocation_refreshed') return changed(allocation, { refresh_by: event.data.refresh_by });
  if (event.type === 'allocation_withdrawn') return changed(allocation, { withdrawn: event.data.detail });
  return changed(allocation, { sequence: event.data.sequence, spent: event.data.spent });
}
