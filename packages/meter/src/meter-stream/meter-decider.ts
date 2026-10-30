import type { Decider, Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import { allocationEvents } from './allocation-decisions.ts';
import { identifiedEvents, invalidatedEvents, licensedEvents, reportedEvents } from './license-decisions.ts';
import { basisOf } from './local-admission.ts';
import type { Admitting, AllocationCommand, DecidedEvent, MeterCommand } from './meter-commands.ts';
import { evolveMeter, MeterEventSchema, noMeter, type MeterEvent, type MeterState } from './meter-events.ts';

type Decision = Result.Result<readonly DecidedEvent[], Rejection<'conflict'>>;

function admitted({ run, at, until, rule, installation: fresh }: Admitting, state: MeterState): Decision {
  const installation = state.installation ?? fresh;
  const identified = identifiedEvents(installation, state);
  if (state.recent.some((hold) => hold.run === run && hold.until > at)) return Result.succeed(identified);
  return Result.map(basisOf(rule, state, installation, at), (basis): readonly DecidedEvent[] => [
    ...identified,
    { type: 'action_admitted', data: { run, until, basis } },
  ]);
}

function isAllocationCommand(command: MeterCommand): command is AllocationCommand {
  return command.type.endsWith('allocation') || command.type === 'allocate';
}

function decided(command: MeterCommand, state: MeterState): Decision {
  if (isAllocationCommand(command)) return Result.succeed(allocationEvents(command, state));
  if (command.type === 'admit') return admitted(command, state);
  if (command.type === 'identify') return Result.succeed(identifiedEvents(command.installation, state));
  if (command.type === 'license') return Result.succeed(licensedEvents(command, state));
  if (command.type === 'invalidate') return Result.succeed(invalidatedEvents(command, state));
  return Result.succeed(reportedEvents(command));
}

export const meterDecider: Decider<MeterState, MeterCommand, MeterEvent, 'conflict'> = {
  initialState: noMeter,
  evolve: evolveMeter,
  eventSchema: MeterEventSchema,
  context: ({ at }) => ({ at, by: 'meter' }),
  decide: decided,
};
