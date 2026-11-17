import type { Notice } from '@on.auto/operations';

import type { Contributes } from '../contributions/contributes-details.ts';
import { isCalendarWindow, type Goal, type Goals } from '../goals/goals-document.ts';
import {
  autosWordNotice,
  markedUnaskedNotice,
  markedUnsaidNotice,
  measuredUnsaidNotice,
  neverAskedNotice,
  titleAnIdNotice,
  type TitleField,
  tooOftenNotice,
} from './setup-notice-words.ts';

export interface SetupWorkflow {
  readonly name: string;
  readonly runsADay: number;
  readonly asks: boolean;
  readonly contributes: Contributes;
}

type Entry = Contributes[number];

type Milestone = NonNullable<Goal['milestones']>[number];

const endsInAnAutoWord = /(?:^|\s)(?:run|workflow|step|event|function|job)s?$/iu;

const mostRunsADay = 24;

const idOrTimeField = /(?:^|[/_-])(?:id|uuid|key|at|time|timestamp|date)$/iu;

function isAutosWord(per: string): boolean {
  return endsInAnAutoWord.test(per.trim());
}

function inPlay(goals: Goals): readonly (readonly [Goal, number])[] {
  return goals.flatMap((goal, index) => (goal.retired === true ? [] : [[goal, index] as const]));
}

function entriesFor(goal: Goal, workflow: SetupWorkflow): readonly (readonly [Entry, number])[] {
  return workflow.contributes.flatMap((entry, index) => (entry.goal === goal.id ? [[entry, index] as const] : []));
}

function opensIt(goal: Goal, entry: Entry): boolean {
  const { window } = goal;
  return window === undefined || isCalendarWindow(window) || entry.marks === window.after;
}

function milestonesMarked(goal: Goal, entries: readonly (readonly [Entry, number])[]): readonly Milestone[] {
  const marked = new Set(entries.map(([{ marks }]) => marks));
  return (goal.milestones ?? []).filter(({ id }) => marked.has(id));
}

function personsOf(milestones: readonly Milestone[]): readonly Milestone[] {
  return milestones.filter(({ by }) => by === 'person');
}

function openingEntries(goal: Goal, workflow: SetupWorkflow): readonly Entry[] {
  return entriesFor(goal, workflow)
    .map(([entry]) => entry)
    .filter((entry) => opensIt(goal, entry));
}

function tooOftenOf(goal: Goal, workflows: readonly SetupWorkflow[]): readonly Notice[] {
  const { per } = goal;
  if (per === undefined) {
    return [];
  }
  const frequent = workflows
    .filter(({ runsADay }) => runsADay > mostRunsADay)
    .filter((workflow) => openingEntries(goal, workflow).length > 0)
    .toSorted((one, other) => other.runsADay - one.runsADay);
  const [most] = frequent;
  if (most === undefined) {
    return [];
  }
  const readsAList = openingEntries(goal, most).every(({ each }) => each !== undefined);
  return [tooOftenNotice(goal, per, { name: most.name, runsADay: most.runsADay, readsAList })];
}

function neverAskedOf(goal: Goal, workflows: readonly SetupWorkflow[]): readonly Notice[] {
  const asked = new Set(
    workflows
      .filter(({ asks }) => asks)
      .flatMap((workflow) => milestonesMarked(goal, entriesFor(goal, workflow)).map(({ id }) => id)),
  );
  const unasked = personsOf(goal.milestones ?? []).filter(({ id }) => !asked.has(id));
  return unasked.length === 0 ? [] : [neverAskedNotice(goal, unasked)];
}

function markedUnaskedOf(goal: Goal, workflow: SetupWorkflow): readonly Notice[] {
  const marked = personsOf(milestonesMarked(goal, entriesFor(goal, workflow)));
  return workflow.asks || marked.length === 0 ? [] : [markedUnaskedNotice(goal, workflow.name, marked)];
}

function readsAsAnId({ exact, title }: TitleField): boolean {
  return exact || idOrTimeField.test(title);
}

function titleOf(goal: Goal, workflow: SetupWorkflow): readonly Notice[] {
  const { per } = goal;
  const titled = entriesFor(goal, workflow).flatMap(([{ title, per_id: perId }]): readonly TitleField[] =>
    title === undefined ? [] : [{ title, exact: title === perId }],
  );
  const named = titled.find((field) => readsAsAnId(field));
  return per === undefined || named === undefined ? [] : [titleAnIdNotice(goal, per, workflow.name, named)];
}

function saysOf(goal: Goal, workflow: SetupWorkflow): readonly Notice[] {
  const entries = entriesFor(goal, workflow);
  const unsaid = entries.find(([{ measures, says }]) => measures !== undefined && says === undefined);
  if (unsaid !== undefined) {
    return [measuredUnsaidNotice(goal, workflow.name, `/contributes/${String(unsaid[1])}`)];
  }
  const marked = milestonesMarked(goal, entries);
  const saysNothing = entries.every(([{ says }]) => says === undefined);
  return saysNothing && marked.length > 0 ? [markedUnsaidNotice(goal, workflow.name, marked)] : [];
}

function autosWordOf(goal: Goal, index: number): readonly Notice[] {
  const { per } = goal;
  return per !== undefined && isAutosWord(per) ? [autosWordNotice(goal, per, `/${String(index)}/per`)] : [];
}

export function goalsSaveNoticesOf(goals: Goals, workflows: readonly SetupWorkflow[]): readonly Notice[] {
  const playing = inPlay(goals);
  return [
    ...playing.flatMap(([goal, index]) => autosWordOf(goal, index)),
    ...playing.flatMap(([goal]) => tooOftenOf(goal, workflows)),
    ...playing.flatMap(([goal]) => neverAskedOf(goal, workflows)),
  ];
}

export function workflowSaveNoticesOf(goals: Goals, workflow: SetupWorkflow): readonly Notice[] {
  const served = inPlay(goals)
    .map(([goal]) => goal)
    .filter((goal) => entriesFor(goal, workflow).length > 0);
  return [
    ...served.flatMap((goal) => tooOftenOf(goal, [workflow])),
    ...served.flatMap((goal) => markedUnaskedOf(goal, workflow)),
    ...served.flatMap((goal) => titleOf(goal, workflow)),
    ...served.flatMap((goal) => saysOf(goal, workflow)),
  ];
}
