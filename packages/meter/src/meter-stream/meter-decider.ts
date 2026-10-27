import { Conflict, type Decider, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import { allocationEvents } from './allocation-decisions.ts';
import { countedEvents, heldAfter } from './checkpoint-events.ts';
import { invalidatedEvents, licensedEvents, repairedEvents, reportedEvents } from './license-decisions.ts';
import type { Admitting, AllocationCommand, DecidedEvent, MeterCommand } from './meter-commands.ts';
import { evolveMeter, MeterEventSchema, noMeter, type MeterEvent, type MeterState } from './meter-events.ts';

type Decision = Result.Result<readonly DecidedEvent[], Rejection<'conflict'>>;

function admitted(command: Admitting, state: MeterState): Decision {
  const { counting, run, allowance, at, until } = command;
  const installation = state.installation ?? command.installation;
  const identified: readonly DecidedEvent[] =
    state.installation === undefined ? [{ type: 'installation_identified', data: { installation } }] : [];
  const counted = countedEvents(state, counting, at);
  const holds = heldAfter(state, counting, at);
  if (holds.some((hold) => hold.run === run)) return Result.succeed([...identified, ...counted]);
  const actions = Math.max(state.checkpoint?.actions ?? 0, counting.actions);
  if (actions + holds.length >= allowance) {
    return Result.fail(new Conflict({ detail: command.refusal(installation), kind: command.kind }));
  }
  return Result.succeed([...identified, ...counted, { type: 'action_admitted', data: { run, until } }]);
}

function isAllocationCommand(command: MeterCommand): command is AllocationCommand {
  return command.type.endsWith('allocation') || command.type === 'allocate';
}

function decided(command: MeterCommand, state: MeterState): Decision {
  if (isAllocationCommand(command)) return Result.succeed(allocationEvents(command, state));
  if (command.type === 'admit') return admitted(command, state);
  if (command.type === 'count') return Result.succeed(countedEvents(state, command.counting, command.at));
  if (command.type === 'fault') return Result.succeed([{ type: 'metering_faulted', data: command.fault }]);
  if (command.type === 'license') return Result.succeed(licensedEvents(command, state));
  if (command.type === 'invalidate') return Result.succeed(invalidatedEvents(command, state));
  if (command.type === 'report') return Result.succeed(reportedEvents(command));
  return Result.succeed(repairedEvents(command, state));
}

export const meterDecider: Decider<MeterState, MeterCommand, MeterEvent, 'conflict'> = {
  initialState: noMeter,
  evolve: evolveMeter,
  eventSchema: MeterEventSchema,
  context: ({ at }) => ({ at, by: 'meter' }),
  decide: decided,
};
