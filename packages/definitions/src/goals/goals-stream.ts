import type { PlaybookContext } from '@on.auto/operations';
import { InvalidInput, PlaybookReader, PlaybookWriter, type Decided, type Decider } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { contributesIn, type Contributes } from '../contributions/contributes-details.ts';
import { commandMetadata } from '../operations/command-metadata.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { agentIssue, type GoalIssue } from './goal-issues.ts';
import { isCalendarWindow, type Goal, type Goals, type GoalsDocument } from './goals-document.ts';
import { GoalsEventSchema, type RecordedGoalsEvent } from './goals-facts.ts';

export const goalsStream = 'goals/playbook';

const defaultTimeZone = 'UTC';

interface ShapePart {
  readonly key: string;
  readonly words: string;
  readonly of: (goal: Goal) => string;
}

function windowKindOf({ window }: Goal): string {
  if (window === undefined) {
    return 'none';
  }
  return isCalendarWindow(window) ? 'calendar' : 'after';
}

function calendarOf({ window }: Goal): string {
  return window !== undefined && isCalendarWindow(window) ? window.calendar : '';
}

function timeZoneOf({ window }: Goal): string {
  return window !== undefined && isCalendarWindow(window) ? (window.time_zone ?? defaultTimeZone) : '';
}

const shapeParts: readonly ShapePart[] = [
  { key: 'per', words: 'what it is judged per', of: ({ per }) => per ?? '' },
  { key: 'window', words: 'the kind of its window', of: windowKindOf },
  { key: 'window/calendar', words: 'the unit of its calendar window', of: calendarOf },
  { key: 'window/time_zone', words: 'the time zone of its window', of: timeZoneOf },
  { key: 'success/settles', words: 'how it settles', of: ({ success }) => success.settles },
];

function shapeIssuesOf(saved: readonly Goal[], saving: readonly Goal[]): readonly GoalIssue[] {
  return saving.flatMap((goal, index) => {
    const before = saved.find(({ id }) => id === goal.id);
    if (before === undefined) {
      return [];
    }
    return shapeParts
      .filter(({ of }) => of(before) !== of(goal))
      .map(({ key, words }) =>
        agentIssue(
          `/${String(index)}/${key}`,
          `The goal ${goal.id} cannot change ${words} once saved; give a goal of another shape a new id`,
        ),
      );
  });
}

function leftOutIssuesOf(
  saved: readonly Goal[],
  saving: readonly Goal[],
  assessed: ReadonlySet<string>,
): readonly GoalIssue[] {
  const kept = new Set(saving.map(({ id }) => id));
  return saved
    .filter(({ id }) => assessed.has(id) && !kept.has(id))
    .map(({ id }) =>
      agentIssue(
        '',
        `The goal ${id} has been judged and cannot be left out; keep it in the list with retired set to true`,
      ),
    );
}

export function retiredGoalIds(goals: readonly Goal[]): readonly string[] {
  return goals.filter(({ retired }) => retired === true).map(({ id }) => id);
}

export interface PlaybookGoals {
  readonly version: number;
  readonly source?: string;
  readonly goals: Goals;
}

export interface GoalsSave {
  readonly document: GoalsDocument;
  readonly assessed: ReadonlySet<string>;
  readonly onlyIfNone?: boolean;
}

interface GoalsSaving extends GoalsSave {
  readonly by: string;
  readonly at: string;
}

type GoalsSaveOutcome = 'saved' | 'unchanged' | 'already_held';

export interface SavedGoals {
  readonly goals: PlaybookGoals;
  readonly outcome: GoalsSaveOutcome;
}

const noGoals: PlaybookGoals = { version: 0, goals: [] };

function heldAlready(standing: PlaybookGoals, { onlyIfNone = false }: GoalsSave): boolean {
  return onlyIfNone && standing.version > 0;
}

function decided(
  saving: GoalsSaving,
  standing: PlaybookGoals,
): Result.Result<readonly Decided<RecordedGoalsEvent>[], InvalidInput> {
  const { document, assessed } = saving;
  if (heldAlready(standing, saving) || standing.source === document.source) {
    return Result.succeed([]);
  }
  const issues = [
    ...leftOutIssuesOf(standing.goals, document.goals, assessed),
    ...shapeIssuesOf(standing.goals, document.goals),
  ];
  if (issues.length > 0) {
    return Result.fail(
      new InvalidInput({
        detail: 'These goals cannot replace the goals saved before',
        issues: issues.map(({ pointer, detail }) => ({ pointer, detail })),
      }),
    );
  }
  return Result.succeed([
    {
      type: 'playbook_goals_saved',
      data: { source: document.source, goals: document.goals, version: standing.version + 1 },
    },
  ]);
}

const goalsDecider: Decider<PlaybookGoals, GoalsSaving, RecordedGoalsEvent, 'invalid_input'> = {
  initialState: noGoals,
  evolve: (_standing, { data }) => ({ version: data.version, source: data.source, goals: data.goals }),
  decide: decided,
  context: ({ by, at }) => ({ by, at }),
  eventSchema: GoalsEventSchema,
  lastFactAlone: true,
};

export const playbookGoalsIn: Effect.Effect<PlaybookGoals, never, PlaybookReader> = PlaybookReader.use((reader) =>
  reader.load(goalsStream, goalsDecider),
).pipe(Effect.map(({ state }) => state));

function outcomeOf(before: PlaybookGoals, after: PlaybookGoals, save: GoalsSave): GoalsSaveOutcome {
  if (after.version > before.version) {
    return 'saved';
  }
  return heldAlready(before, save) ? 'already_held' : 'unchanged';
}

export const playbookGoalsSaved = Effect.fnUntraced(function* (save: GoalsSave) {
  const metadata = yield* commandMetadata;
  const { state, decidedOn } = yield* (yield* PlaybookWriter).execute(goalsStream, goalsDecider, {
    ...save,
    ...metadata,
  });
  const saved: SavedGoals = { goals: state, outcome: outcomeOf(decidedOn, state, save) };
  return saved;
});

interface StandingWorkflow {
  readonly name: string;
  readonly version: number;
  readonly paused: boolean;
  readonly contributes: Contributes;
}

export interface GoalStanding extends PlaybookGoals {
  readonly workflows: readonly StandingWorkflow[];
  readonly notifiers: ReadonlySet<string>;
}

function notRetiredIn(registered: ReadonlyMap<string, RegisteredDefinition>): readonly RegisteredDefinition[] {
  return [...registered.values()].filter(({ status }) => status !== 'retired');
}

function standingWorkflowOf({ name, version, status, details }: RegisteredDefinition): StandingWorkflow {
  return { name, version, paused: status === 'paused', contributes: contributesIn(details) ?? [] };
}

function isNotification({ output_schema: answer, details }: RegisteredDefinition): boolean {
  return answer === undefined && details?.['call'] === undefined;
}

export const goalStandingIn: Effect.Effect<GoalStanding, never, PlaybookReader | PlaybookContext> = Effect.gen(
  function* () {
    const goals = yield* playbookGoalsIn;
    const workflows = notRetiredIn(yield* loadRegistry('workflow')).map((stored) => standingWorkflowOf(stored));
    const interactions = notRetiredIn(yield* loadRegistry('interaction'));
    const notifiers = new Set(interactions.filter((stored) => isNotification(stored)).map(({ name }) => name));
    return { ...goals, workflows, notifiers };
  },
);
