import { InvalidInput } from '@on.auto/operations';
import { capitalized, counted, listed, quoted, type Noun } from '@on.auto/phrasing';

import type { GoalGap } from '../goals/goals-answer.ts';
import type { Playbook } from '../registry/playbook.ts';
import { playbookNamed, purposeOf } from './playbook-words.ts';

export const purposeQuestion = 'What should this playbook achieve for you, and how will you know it worked?';

export const whereGoalsGo =
  'Send the answer as the goals argument of update_playbook or create_playbook, as the goals guide says.';

const whatToLearn = {
  told: 'what it should achieve for them, how they will know it worked, and what they want to be told and where',
  untold: 'what it should achieve for them and how they will know it worked',
};

function whatToLearnWhere(messages: boolean): string {
  return messages ? whatToLearn.told : whatToLearn.untold;
}

export function askedBeforeMakingWordsOf(messages: boolean): string {
  return `Before you make anything for the person, ask ${whatToLearnWhere(messages)}, as the goals guide says.`;
}

export function searchLeadWhereGoalsAreKeptOf(messages: boolean): string {
  return `To do work for the person here, read the guide start with get_guide, and before you make anything ask them ${whatToLearnWhere(messages)}. `;
}

export function askingThePerson(question: string): string {
  return `Ask the person: ${question}`;
}

const toldWhereQuestion = 'Ask too what to tell them, and where.';

function toldWhereAsked(messages: boolean): readonly string[] {
  return messages ? [toldWhereQuestion] : [];
}

const answersGoWords =
  'Once they say yes, send it as the goals argument of update_playbook or create_playbook, as the goals guide says.';

export function goalsWantedWordsOf(messages: boolean): string {
  return [askingThePerson(purposeQuestion), ...toldWhereAsked(messages), answersGoWords].join(' ');
}

export function goalsWanted(pointer: string, messages: boolean): InvalidInput {
  const detail = goalsWantedWordsOf(messages);
  return new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

export const noGoalGap: GoalGap = {
  kind: 'no_goal',
  detail: askingThePerson(purposeQuestion),
  fixed_by: 'person',
  ask: purposeQuestion,
};

const gapNoun: Noun = { one: 'gap', other: 'gaps' };

function goalsAwaitedWords(messages: boolean): string {
  return [
    'It has no goals yet.',
    askingThePerson(purposeQuestion),
    ...toldWhereAsked(messages),
    'Once they say yes, send it as the goals argument of update_playbook, as the goals guide says.',
  ].join(' ');
}

const noGoalMessagesWords =
  'Auto sends no goal messages here: if the person asked to be told, tell them so first, and build a post only after their yes.';

export function goalsSavedWordsOf(messages: boolean): string {
  return messages ? '' : ` ${noGoalMessagesWords}`;
}

const theYesRecordedWords =
  'If these are the goals the person said yes to, record that yes with agree_playbook_goals; if not, ask again. Build nothing before that call.';

const untilTheYesWords = `Stop here: give the person the \`studio\` link. ${theYesRecordedWords}`;

const untilTheNewYesWords = `Stop here. ${theYesRecordedWords}`;

function joinedOrNone(sentences: readonly string[]): string | undefined {
  return sentences.length === 0 ? undefined : sentences.join(' ');
}

function untoldWhere(messages: boolean): readonly string[] {
  return messages ? [] : [noGoalMessagesWords];
}

export function beforeBuildingAfterCreateOf(messages: boolean): string {
  return [untilTheYesWords, ...untoldWhere(messages)].join(' ');
}

export interface GoalsSent {
  readonly sent: boolean;
  readonly awaiting: boolean;
}

export function beforeBuildingAfterUpdateOf({ sent, awaiting }: GoalsSent, messages: boolean): string | undefined {
  if (!sent) {
    return undefined;
  }
  return joinedOrNone([...(awaiting ? [untilTheNewYesWords] : []), ...untoldWhere(messages)]);
}

export function beforeBuildingAfterAgreeOf(messages: boolean): string | undefined {
  return joinedOrNone(untoldWhere(messages));
}

export function goalsStandingOf(gaps: readonly GoalGap[], messages: boolean): string {
  if (gaps.some(({ kind }) => kind === 'no_goal')) {
    return ` ${goalsAwaitedWords(messages)}`;
  }
  return gaps.length === 0
    ? ''
    : ` Its goals still have ${counted(gaps.length, gapNoun)}, each saying what is missing and who puts it right.`;
}

export type AnsweredWithGoals = Pick<Playbook, 'name' | 'description'> & {
  readonly goals: { readonly gaps: readonly GoalGap[] };
};

export function createdWithGoalsWordsOf(messages: boolean): (playbook: AnsweredWithGoals) => string {
  return (playbook) => {
    const standing = goalsStandingOf(playbook.goals.gaps, messages);
    return messages
      ? `Created ${playbookNamed(playbook)}.${purposeOf(playbook)} ${untilTheYesWords}${standing}`
      : `Created ${playbookNamed(playbook)}. ${untilTheYesWords}${goalsSavedWordsOf(messages)}${purposeOf(playbook)}${standing}`;
  };
}

interface Updating {
  readonly goals?: string | undefined;
}

export function updatedWithGoalsWordsOf(messages: boolean): (playbook: AnsweredWithGoals, input: Updating) => string {
  return (playbook, { goals }) =>
    `Updated ${playbookNamed(playbook)}.${goals === undefined ? '' : goalsSavedWordsOf(messages)}${purposeOf(playbook, ' It has no description now.')}${goalsStandingOf(playbook.goals.gaps, messages)}`;
}

export interface GoalRenameAsked {
  readonly id: string;
  readonly new_id: string;
}

export function goalRenameAttempt({ id, new_id: to }: GoalRenameAsked): string {
  return `rename the goal ${id} to ${quoted(to)}`;
}

interface SavedAgain {
  readonly name: string;
}

function savedAgainWords(savedAgain: readonly SavedAgain[]): string {
  if (savedAgain.length === 0) {
    return '';
  }
  const named = capitalized(listed(savedAgain.map(({ name }) => `the workflow ${name}`)));
  return savedAgain.length === 1
    ? ` ${named} has a new version with the new id.`
    : ` ${named} each have a new version with the new id.`;
}

export function goalRenamedWords({ id, new_id: to }: GoalRenameAsked, savedAgain: readonly SavedAgain[]): string {
  return `Renamed the goal ${id} to ${quoted(to)}. Its results stay with it, and so does the person's yes if they gave one.${savedAgainWords(savedAgain)}`;
}
