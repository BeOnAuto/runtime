import { Conflict, type Decided as DecidedEvent, type Decider, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import { digestOf } from '../counting/checkpoint-digest.ts';
import type { Counting } from '../counting/run-starts.ts';
import {
  evolveMeter,
  MeterEventSchema,
  noMeter,
  type Fault,
  type MeterEvent,
  type MeterState,
} from './meter-events.ts';

interface Admitting {
  readonly type: 'admit';
  readonly run: string;
  readonly counting: Counting;
  readonly allowance: number;
  readonly at: string;
  readonly until: string;
  readonly installation: string;
  readonly refusal: (installation: string) => string;
}

interface Checkpointing {
  readonly type: 'count';
  readonly counting: Counting;
  readonly at: string;
}

interface Faulting {
  readonly type: 'fault';
  readonly fault: Fault;
  readonly at: string;
}

export type MeterCommand = Admitting | Checkpointing | Faulting;

type Decided = DecidedEvent<MeterEvent>;

function heldAfter(state: MeterState, counting: Counting, at: string): MeterState['holds'] {
  return state.holds.filter(({ run, until }) => !counting.hasStarted(run) && until > at);
}

interface Settled {
  readonly started: readonly string[];
  readonly lapsed: readonly string[];
}

function settledHolds(state: MeterState, counting: Counting, at: string): Settled {
  return {
    started: state.holds.filter(({ run }) => counting.hasStarted(run)).map(({ run }) => run),
    lapsed: state.holds.filter(({ run, until }) => !counting.hasStarted(run) && until <= at).map(({ run }) => run),
  };
}

function movesTheCount(kept: MeterState['checkpoint'], counting: Counting, { started, lapsed }: Settled): boolean {
  const keptActions = kept?.actions ?? 0;
  const moved = kept?.last !== counting.last || keptActions !== counting.actions;
  return counting.actions >= keptActions && (moved || started.length + lapsed.length > 0);
}

function countedEvents(state: MeterState, counting: Counting, at: string): readonly Decided[] {
  const settled = settledHolds(state, counting, at);
  const { through, last, actions } = counting;
  if (through === undefined || last === undefined || !movesTheCount(state.checkpoint, counting, settled)) return [];
  return [
    {
      type: 'actions_counted',
      data: { actions, through, last, digest: digestOf({ actions, through, last }), ...settled },
    },
  ];
}

function admitted(command: Admitting, state: MeterState): Result.Result<readonly Decided[], Rejection<'conflict'>> {
  const { counting, run, allowance, at, until } = command;
  const installation = state.installation ?? command.installation;
  const identified: readonly Decided[] =
    state.installation === undefined ? [{ type: 'installation_identified', data: { installation } }] : [];
  const counted = countedEvents(state, counting, at);
  const holds = heldAfter(state, counting, at);
  if (holds.some((hold) => hold.run === run)) return Result.succeed([...identified, ...counted]);
  const actions = Math.max(state.checkpoint?.actions ?? 0, counting.actions);
  if (actions + holds.length >= allowance) {
    return Result.fail(new Conflict({ detail: command.refusal(installation), kind: 'license_required' }));
  }
  return Result.succeed([...identified, ...counted, { type: 'action_admitted', data: { run, until } }]);
}

export const meterDecider: Decider<MeterState, MeterCommand, MeterEvent, 'conflict'> = {
  initialState: noMeter,
  evolve: evolveMeter,
  eventSchema: MeterEventSchema,
  context: ({ at }) => ({ at, by: 'meter' }),
  decide: (command, state) => {
    if (command.type === 'admit') return admitted(command, state);
    if (command.type === 'count') return Result.succeed(countedEvents(state, command.counting, command.at));
    return Result.succeed([{ type: 'metering_faulted', data: command.fault }]);
  },
};
