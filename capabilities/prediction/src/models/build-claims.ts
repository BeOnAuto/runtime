import { recordedRunIn, type RecordedRun } from '@on.auto/definitions';
import {
  Conflict,
  streamPrefixOfPlaybook,
  Unavailable,
  type Decider,
  type Lineage,
  type PlaybookAddress,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { predictionBounds, predictionDefinitionType } from '../capability/prediction-bounds.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { ModelFactSchema, modelsStreamOf, type ModelFact, type RecordedModelFact } from '../facts/model-facts.ts';
import { evolveModels, noModels, type AskedBuild, type ModelsState } from './model-state.ts';

const day = 86_400_000;

export interface ClaimCommand {
  readonly at: string;
  readonly by: string;
  readonly name: string;
  readonly definitionVersion: number;
  readonly build: string;
  readonly now: number;
  readonly perDay: number;
  readonly ending: readonly string[];
}

type Decision = Result.Result<readonly ModelFact[], Conflict | Unavailable>;

function inFlightOf(state: ModelsState, ending: ReadonlySet<string>): AskedBuild | undefined {
  return state.asked.find(({ build }) => !state.ended.has(build) && !ending.has(build));
}

function fullForTheDay(state: ModelsState, { now, perDay }: ClaimCommand): Unavailable | undefined {
  const today = state.asked.filter(({ askedAt }) => askedAt > now - day);
  if (today.length < perDay) {
    return undefined;
  }
  const freed = Math.min(...today.slice(-perDay).map(({ askedAt }) => askedAt)) + day;
  return new Unavailable({
    detail: `This function has had its ${perDay} builds of the day; ask again after ${new Date(freed).toISOString()}`,
    kind: 'builds_full',
    because: 'builds_of_the_day',
  });
}

function claimed(command: ClaimCommand, state: ModelsState): Decision {
  if (state.asked.some(({ build }) => build === command.build)) {
    return Result.succeed([]);
  }
  const ending = command.ending.filter((build) => !state.ended.has(build));
  const inFlight = inFlightOf(state, new Set(ending));
  if (inFlight !== undefined) {
    return Result.fail(
      new Conflict({
        detail: `A build of this function is in flight, run ${inFlight.build}; wait for it or cancel it`,
        kind: 'build_in_flight',
      }),
    );
  }
  const full = fullForTheDay(state, command);
  return full === undefined
    ? Result.succeed([
        ...ending.map((build): ModelFact => ({ type: 'build_ended', data: { build } })),
        { type: 'build_asked', data: { build: command.build, asked_at: new Date(command.now).toISOString() } },
      ])
    : Result.fail(full);
}

export const claimsDecider: Decider<ModelsState, ClaimCommand, RecordedModelFact, 'conflict' | 'unavailable'> = {
  initialState: noModels,
  evolve: evolveModels,
  decide: claimed,
  context: (command) => ({
    at: command.at,
    by: command.by,
    definitionType: predictionDefinitionType,
    definitionName: command.name,
    definitionVersion: command.definitionVersion,
  }),
  eventSchema: ModelFactSchema,
};

export interface Claiming {
  readonly ports: Pick<PredictionPorts, 'ledger'>;
  readonly playbook: PlaybookAddress;
  readonly lineage: Lineage;
  readonly command: Omit<ClaimCommand, 'ending'>;
}

export interface ClaimedRun {
  readonly status: string;
  readonly awaitsSettlement: boolean;
}

export function claimHasEnded(run: ClaimedRun | undefined, { askedAt }: AskedBuild, now: number): boolean {
  if (run === undefined || run.status !== 'started') {
    return true;
  }
  return !run.awaitsSettlement && askedAt < now - predictionBounds.buildStartMs;
}

function claimedRunOf(run: RecordedRun | undefined): ClaimedRun | undefined {
  return run === undefined ? undefined : { status: run.run.status, awaitsSettlement: run.awaitsSettlement };
}

function endedClaims({ ports, playbook }: Claiming, state: ModelsState, now: number): Effect.Effect<readonly string[]> {
  const open = state.asked.filter(({ build }) => !state.ended.has(build));
  return Effect.map(
    Effect.forEach(open, (asked) =>
      Effect.map(recordedRunIn(ports.ledger, { ...playbook, id: asked.build }), (run) =>
        claimHasEnded(claimedRunOf(run), asked, now) ? [asked.build] : [],
      ),
    ),
    (ended: readonly (readonly string[])[]) => ended.flat(),
  );
}

function claimsStreamOf({ playbook, command }: Claiming): string {
  return `${streamPrefixOfPlaybook(playbook)}${modelsStreamOf(command.name)}`;
}

interface Claims {
  readonly state: ModelsState;
  readonly command: ClaimCommand;
}

function claimsOf(claiming: Claiming): Effect.Effect<Claims> {
  return Effect.gen(function* () {
    const { state } = yield* claiming.ports.ledger.load(claimsStreamOf(claiming), claimsDecider);
    const ending = yield* endedClaims(claiming, state, claiming.command.now);
    return { state, command: { ...claiming.command, ending } };
  });
}

export function claimable(claiming: Claiming): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.flatMap(claimsOf(claiming), ({ state, command }) => {
    const decision = claimed(command, state);
    return Result.isFailure(decision) ? Effect.fail(decision.failure) : Effect.void;
  });
}

export function claimedBuild(claiming: Claiming): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const { command } = yield* claimsOf(claiming);
    yield* claiming.ports.ledger.execute(claimsStreamOf(claiming), claimsDecider, command, claiming.lineage);
  });
}
