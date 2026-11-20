import type { Goal, HeldGoal } from '@on.auto/definitions/goals';
import { PlaybookReader } from '@on.auto/operations';
import type { GoalGap } from '@on.auto/playbooks';
import { Effect } from 'effect';

import { observationsName, observedEntryKeyOf } from '../goal-tables/observation-rows.ts';
import { refusalsName } from '../goal-tables/refusal-rows.ts';
import type { GoalsStanding, StandingWorkflow } from './goal-gaps.ts';

const mostDetailBytes = 256;

const utf8 = new TextEncoder();

function bytesOf(text: string): number {
  return utf8.encode(text).length;
}

function wordsAround(workflow: string, goal: string, refused: string): string {
  return `The latest run of ${workflow} reported something the goal ${goal} could not read (${refused}); fix its output or its contribution, and its next run counts.`;
}

function trimmedTo(room: number, text: string): string {
  const characters = Array.from(text);
  return bytesOf(text) <= room ? text : trimmedTo(room, `${characters.slice(0, -2).join('')}…`);
}

export function observationRefusedGap(goal: string, workflow: string, refused: string): GoalGap {
  const room = mostDetailBytes - bytesOf(wordsAround(workflow, goal, ''));
  return {
    kind: 'observation_refused',
    goal,
    workflow,
    detail: wordsAround(workflow, goal, trimmedTo(room, refused)),
    fixed_by: 'agent',
  };
}

interface Contributing {
  readonly workflow: StandingWorkflow;
  readonly entries: readonly number[];
}

function contributingTo({ id }: Goal, workflows: readonly StandingWorkflow[]): readonly Contributing[] {
  return workflows.flatMap((workflow) => {
    const entries = workflow.contributes.flatMap(({ goal }, index) => (goal === id ? [index] : []));
    return workflow.paused || entries.length === 0 ? [] : [{ workflow, entries }];
  });
}

type GoalReader = ReturnType<PlaybookReader['Service']['ofDefinition']>;

function observedSince(reader: GoalReader, { workflow, entries }: Contributing, at: number) {
  return Effect.map(
    Effect.forEach(entries, (entry) =>
      reader.countProjectedRows(observationsName, [
        {
          column: 'row_key',
          equals: observedEntryKeyOf({ workflow: workflow.name, version: workflow.version, entry }),
        },
        { column: 'observed_at', after: at },
      ]),
    ),
    (counts: readonly number[]) => counts.some((count) => count > 0),
  );
}

function gapOf(reader: GoalReader, goal: Goal, contributing: Contributing) {
  const workflow = contributing.workflow.name;
  return Effect.flatMap(
    reader.readProjectedRows(refusalsName, {
      where: [{ column: 'row_key', equals: workflow }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([refusal]): Effect.Effect<readonly GoalGap[]> => {
      const at = refusal?.row['at'];
      const detail = refusal?.row['detail'];
      if (typeof at !== 'number' || typeof detail !== 'string') {
        return Effect.succeed([]);
      }
      return Effect.map(observedSince(reader, contributing, at), (observed) =>
        observed ? [] : [observationRefusedGap(goal.id, workflow, detail)],
      );
    },
  );
}

export function observationGapsIn({
  held,
  workflows,
}: Pick<GoalsStanding, 'held' | 'workflows'>): Effect.Effect<readonly GoalGap[], never, PlaybookReader> {
  return Effect.gen(function* () {
    const reader = yield* PlaybookReader;
    const gaps = yield* Effect.forEach(
      held.filter(({ goal }) => goal.retired !== true),
      ({ definition, goal }: HeldGoal) =>
        Effect.forEach(contributingTo(goal, workflows), (contributing) =>
          gapOf(reader.ofDefinition(definition), goal, contributing),
        ),
    );
    return gaps.flat(2);
  });
}
