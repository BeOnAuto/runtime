import type { Notice } from '@on.auto/operations';
import { listed } from '@on.auto/phrasing';

import type { Goal } from '../goals/goals-document.ts';

const setupNoticeKinds = {
  autosWord: 'per_is_an_auto_word',
  tooOften: 'judged_too_often',
  personUnasked: 'person_milestone_unasked',
  saysMissing: 'says_missing',
  titleAnId: 'title_reads_as_an_id',
} as const;

type Milestone = NonNullable<Goal['milestones']>[number];

function nameOf({ name, id }: Goal): string {
  return name ?? id;
}

function labelsOf(milestones: readonly Milestone[]): string {
  return listed(milestones.map(({ label }) => `"${label}"`));
}

function timesInWords(count: number): string {
  return count.toLocaleString('en-US');
}

export function autosWordNotice(goal: Goal, per: string, at: string): Notice {
  return {
    kind: setupNoticeKinds.autosWord,
    detail: `The goal ${nameOf(goal)} is judged per ${per}, a word Auto uses for its own parts. The person reads it as the name of their thing everywhere in Studio. Ask what they call one, such as an order or a check, and use their word: it cannot change once saved. If ${per} is their own word, carry on.`,
    at,
    certainty: 'likely',
  };
}

export interface FrequentWorkflow {
  readonly name: string;
  readonly runsADay: number;
  readonly readsAList: boolean;
}

export function tooOftenNotice(goal: Goal, per: string, { name, runsADay, readsAList }: FrequentWorkflow): Notice {
  const count = timesInWords(runsADay);
  const opening = readsAList
    ? `${name} runs about ${count} times a day: if each run brings a new one, the person reads about ${count} rows a day in Studio.`
    : `${name} opens one with each run, about ${count} times a day, so the person reads about ${count} rows a day in Studio.`;
  return {
    kind: setupNoticeKinds.tooOften,
    detail: `The goal ${nameOf(goal)} judges each ${per} on its own, and ${opening} Unless they asked for each one, suggest judging by the day (window calendar: day, no per) and say back what they will see. If ${readsAList ? 'each run sees the same few again, or ' : ''}they asked for each one, carry on.`,
    certainty: readsAList ? 'reminder' : 'likely',
  };
}

export function markedUnaskedNotice(goal: Goal, workflow: string, milestones: readonly Milestone[]): Notice {
  return {
    kind: setupNoticeKinds.personUnasked,
    detail: `${workflow} marks ${labelsOf(milestones)} for the goal ${nameOf(goal)}, which the person does, but it asks them nothing, and Studio shows it as theirs to do. A person's milestone needs a request that asks them and marks it on their answer. If Auto only sees it happen, ask the person to make it by: auto. If it asks them another way, carry on.`,
    certainty: 'likely',
  };
}

export function neverAskedNotice(goal: Goal, milestones: readonly Milestone[]): Notice {
  return {
    kind: setupNoticeKinds.personUnasked,
    detail: `${labelsOf(milestones)} of the goal ${nameOf(goal)} ${milestones.length === 1 ? 'is' : 'are'} the person's to do, and no workflow asks them for it yet. A person's milestone needs a request that asks them and marks it on their answer; with nothing asking them it is never marked. Build that request, or leave it out with their yes. If you are building it next, carry on.`,
    certainty: 'reminder',
  };
}

export function measuredUnsaidNotice(goal: Goal, workflow: string, at: string): Notice {
  return {
    kind: setupNoticeKinds.saysMissing,
    detail: `${workflow} measures the goal ${nameOf(goal)} with no says. In Studio the person reads that sentence about each result: one plain sentence with the numbers and the names of what is missing or failed, such as "9 of 14 checks reported. Missing: audit-trail." Have the workflow write it and point says at it. If the number says it all, carry on.`,
    at,
    certainty: 'likely',
  };
}

export function markedUnsaidNotice(goal: Goal, workflow: string, milestones: readonly Milestone[]): Notice {
  return {
    kind: setupNoticeKinds.saysMissing,
    detail: `${workflow} marks ${labelsOf(milestones)} for the goal ${nameOf(goal)} with no says, so the person sees the tick and no sentence about what happened. Point says at one plain sentence written for them, with what happened and any numbers. If the tick says it all, carry on.`,
    certainty: 'reminder',
  };
}

export interface TitleField {
  readonly title: string;
  readonly exact: boolean;
}

export function titleAnIdNotice(goal: Goal, per: string, workflow: string, { title, exact }: TitleField): Notice {
  return {
    kind: setupNoticeKinds.titleAnId,
    detail: `${workflow} titles each ${per} of the goal ${nameOf(goal)} from ${title}, ${exact ? 'the same field as its id' : 'which reads as an id or a time'}. The person reads the title in every list and heading: point it at the name a person would call it, such as "Cold email batch to dental clinics". If ${title} holds that name, carry on.`,
    certainty: exact ? 'exact' : 'likely',
  };
}
