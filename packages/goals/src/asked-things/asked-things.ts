import { goalStandingIn, type Goal } from '@on.auto/definitions/goals';
import { PlaybookReader, type PlaybookContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { mostOpenItemsSearched } from '../assessor/stopped-runs.ts';
import { chainOriginsOf, type ChainReads, type OutsideEvent } from '../chain-origins/chain-origins.ts';
import {
  actsOf,
  outsideEventsOf,
  sharesTheEvent,
  type ActOfARun,
  type OutsideEventOfARun,
} from '../chain-origins/outside-events.ts';
import { playbookChainReads } from '../chain-origins/playbook-chain-reads.ts';
import { heldAssessmentsOf, type HeldAssessment } from '../reads/assessment-read.ts';
import { goalRowsOf, openRowsOf, type DismissedAsked } from '../results/goal-rows.ts';

export const mostThingsOfARequest = 10;

export interface AskedThing {
  readonly goal: string;
  readonly id: string;
  readonly per?: string;
}

interface OpenThing {
  readonly thing: AskedThing;
  readonly acts: readonly ActOfARun[];
}

interface AskingChain {
  readonly runs: ReadonlySet<string>;
  readonly outside: OutsideEvent | undefined;
}

const noCallers = { serviceCallers: new Set<string>() };

function thingOf(goal: Goal, { id, pinned, state }: HeldAssessment): OpenThing {
  const per = pinned.per === undefined ? {} : { per: pinned.per };
  return { thing: { goal: goal.id, id, ...per }, acts: actsOf(state) };
}

function openThingsOf(
  reader: PlaybookReader['Service'],
  goal: Goal,
  asked: DismissedAsked,
): Effect.Effect<readonly OpenThing[]> {
  return Effect.map(
    openRowsOf(goalRowsOf(reader, goal), asked).read([], ['opened_at'], 'desc', mostOpenItemsSearched),
    (rows) => rows.flatMap((row) => heldAssessmentsOf(row).map((held) => thingOf(goal, held))),
  );
}

interface Walks<E> {
  readonly asking: (asked: string, before: readonly string[]) => Effect.Effect<AskingChain, E>;
  readonly began: OutsideEventOfARun<E>;
}

function walksOf<E>(reads: ChainReads<E>): Walks<E> {
  const origins = chainOriginsOf(reads, noCallers);
  return {
    asking: (asked, before) =>
      Effect.map(origins.chainOf({ run: asked }), ({ runs, outside }) => ({
        runs: new Set([asked, ...before, ...runs]),
        outside,
      })),
    began: outsideEventsOf(origins),
  };
}

function aboutOf<E>(walks: Walks<E>, things: readonly OpenThing[], chain: AskingChain) {
  return Effect.map(
    Effect.filter(things, ({ acts }) =>
      acts.some(({ run }) => chain.runs.has(run))
        ? Effect.succeed(true)
        : sharesTheEvent(walks.began, acts, chain.outside),
    ),
    (tied: readonly OpenThing[]) => tied.slice(0, mostThingsOfARequest).map(({ thing }) => thing),
  );
}

export function thingsAskedAboutOver<E>(
  reads: ChainReads<E>,
  chains: readonly (readonly string[])[],
  dismissed: DismissedAsked = {},
): Effect.Effect<readonly (readonly AskedThing[])[], E, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    if (chains.every((causes) => causes.length === 0)) {
      return chains.map(() => []);
    }
    const reader = yield* PlaybookReader;
    const { goals } = yield* goalStandingIn;
    const open = goals.filter(({ retired }) => retired !== true);
    const things = (yield* Effect.forEach(open, (goal) => openThingsOf(reader, goal, dismissed))).flat();
    const walks = walksOf(reads);
    return yield* Effect.forEach(chains, ([asked, ...before]) =>
      things.length === 0 || asked === undefined
        ? Effect.succeed([])
        : Effect.flatMap(walks.asking(asked, before), (chain) => aboutOf(walks, things, chain)),
    );
  });
}

export function thingsAskedAbout(
  chains: readonly (readonly string[])[],
  dismissed: DismissedAsked = {},
): Effect.Effect<readonly (readonly AskedThing[])[], never, PlaybookReader | PlaybookContext> {
  return Effect.flatMap(PlaybookReader, (reader) =>
    thingsAskedAboutOver(playbookChainReads(reader), chains, dismissed),
  );
}
