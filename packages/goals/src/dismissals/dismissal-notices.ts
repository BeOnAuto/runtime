import type { Notice } from '@on.auto/operations';

import type { AssessmentState } from '../assessments/assessment-state.ts';
import type { Dismissed } from '../assessments/dismissing.ts';
import { lately, mostDismissedLatelyRead, type DismissedLately } from './dismissed-lately.ts';

export const restoring = {
  restore: (what: string): string => `restore ${what}`,
  done: 'Restored',
  past: 'restored',
} as const;

const dismissedForEveryone: Notice = {
  kind: 'dismissed_for_everyone',
  detail: `Dismissed for everyone in the organization, not only for the person: its goal's Outstanding in Studio leaves it out for all of them, and list_interactions leaves its requests out unless asked with dismissed: include. Tell the person. If they did not clearly ask, in so many words, to take this thing off what waits on them, ${restoring.restore('it')} now with dismissed: false and ask; "ignore it" is not asking.`,
  certainty: 'reminder',
};

const questionStillWaits: Notice = {
  kind: 'question_still_waits',
  detail:
    'Dismissing set the thing aside, not its request: the request still waits and can be answered until it expires, and nothing was answered. Tell the person; if they gave its answer, send it with answer_interaction, finding its run_id with list_interactions and dismissed: include.',
  certainty: 'exact',
};

const alreadyJudged: Notice = {
  kind: 'already_judged',
  detail:
    'This thing already has its result, and the result still counts toward the goal: dismissing changes no result.',
  certainty: 'exact',
};

export function isJudged({ verdict, ended }: AssessmentState): boolean {
  return verdict !== 'open' || ended !== undefined;
}

const mostNamed = 3;

const mostNameCharacters = 36;

function nameOf({ id, per }: DismissedLately): string {
  const name = per ?? id;
  return name.length <= mostNameCharacters ? name : `${name.slice(0, mostNameCharacters - 1)}…`;
}

function namesOf(others: readonly DismissedLately[]): string {
  const named = others.slice(0, mostNamed).map((other) => nameOf(other));
  const more = others.length - named.length;
  return `${named.join(', ')}${more === 0 ? '' : ` and ${String(more)} more`}`;
}

function dismissedLatelyNotice(others: readonly DismissedLately[]): Notice {
  const count = `${others.length === mostDismissedLatelyRead ? 'at least ' : ''}${String(others.length + 1)}`;
  return {
    kind: 'dismissed_several',
    detail: `Asking for several, even all of them, is not a yes to each: if the person did not say yes to each of these by name, ${restoring.restore('those without a yes')} now with dismissed: false and ask. You dismissed ${count} things of this playbook in the last ${String(lately.minutes)} minutes: this one, then ${namesOf(others)}.`,
    certainty: 'reminder',
  };
}

export function dismissalNoticesOf(
  dismissed: AssessmentState,
  { requests }: Dismissed,
  others: readonly DismissedLately[],
): readonly Notice[] {
  return [
    dismissedForEveryone,
    ...(others.length === 0 ? [] : [dismissedLatelyNotice(others)]),
    ...(requests.length === 0 ? [] : [questionStillWaits]),
    ...(isJudged(dismissed) ? [alreadyJudged] : []),
  ];
}
