import { Option } from 'effect';

import type { Allocation } from './allocation-events.ts';
import type {
  Allocating,
  AllocationCommand,
  AllocationRefreshing,
  AllocationReporting,
  AllocationWithdrawing,
  DecidedEvent,
} from './meter-commands.ts';
import type { MeterState } from './meter-events.ts';

function standingWith(state: MeterState, id: string): Option.Option<Allocation> {
  return Option.filter(Option.fromNullishOr(state.allocation), (allocation) => allocation.id === id);
}

function refreshedEvents(
  { id, refresh_by: refreshBy, allocation }: Pick<AllocationRefreshing, 'id' | 'refresh_by' | 'allocation'>,
  state: MeterState,
): readonly DecidedEvent[] {
  const later = Option.filter(
    standingWith(state, id),
    (standing) => standing.withdrawn === undefined && Date.parse(refreshBy) > Date.parse(standing.refresh_by),
  );
  return Option.toArray(
    Option.map(later, (): DecidedEvent => ({
      type: 'allocation_refreshed',
      data: { id, refresh_by: refreshBy, allocation },
    })),
  );
}

function allocatedEvents({ allocation }: Allocating, state: MeterState): readonly DecidedEvent[] {
  if (Option.isSome(standingWith(state, allocation.id))) return refreshedEvents(allocation, state);
  const identified: readonly DecidedEvent[] =
    state.installation === undefined
      ? [{ type: 'installation_identified', data: { installation: allocation.installation } }]
      : [];
  return [...identified, { type: 'allocation_received', data: allocation }];
}

function withdrawnEvents({ id, detail }: AllocationWithdrawing, state: MeterState): readonly DecidedEvent[] {
  const standing = Option.filter(standingWith(state, id), ({ withdrawn }) => withdrawn === undefined);
  return Option.toArray(
    Option.map(standing, (): DecidedEvent => ({ type: 'allocation_withdrawn', data: { id, detail } })),
  );
}

function reportedEvents({ spent, at }: AllocationReporting, state: MeterState): readonly DecidedEvent[] {
  return Option.toArray(
    Option.map(Option.fromNullishOr(state.allocation), ({ id, installation, sequence }): DecidedEvent => ({
      type: 'allocation_reported',
      data: { allocation: id, installation, sequence: sequence + 1, spent, at },
    })),
  );
}

export function allocationEvents(command: AllocationCommand, state: MeterState): readonly DecidedEvent[] {
  if (command.type === 'allocate') return allocatedEvents(command, state);
  if (command.type === 'refresh_allocation') return refreshedEvents(command, state);
  if (command.type === 'withdraw_allocation') return withdrawnEvents(command, state);
  return reportedEvents(command, state);
}
