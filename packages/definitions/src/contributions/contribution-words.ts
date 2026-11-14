import { goalQuestions, withinDetailBytes } from '../goals/goal-issues.ts';

function listed(ids: readonly string[]): string {
  return ids.join(', ');
}

export function goalsWantedAtSaveWordsOf(messages: boolean): string {
  return [
    `Ask the person: ${goalQuestions.purpose}`,
    ...(messages ? ['Ask too what to tell them, and where.'] : []),
    'Once they say yes, send it as the goals argument of update_playbook, as the goals guide says, then save the workflow again.',
  ].join(' ');
}

export const contributesWantedWords =
  'This playbook has goals, so a workflow says what it does for them: add contributes, a list that names each goal it serves and its purpose, as the goals guide says';

export const contributionsMisfitWords =
  'What the workflow contributes does not fit the goals of the playbook; each issue says what to change';

export const contributionWords = {
  unknownGoal: (goal: string, kept: readonly string[]) =>
    withinDetailBytes(
      kept.length === 0
        ? `The playbook has no goal ${goal}, and every goal it has is retired`
        : `The playbook has no goal ${goal}; name one of its goals: ${listed(kept)}`,
    ),
  retiredGoal: (goal: string) =>
    withinDetailBytes(
      `The goal ${goal} is retired, so a workflow no longer contributes to it; name a goal that is not retired`,
    ),
  unknownMilestone: (goal: string, marks: string, milestones: readonly string[]) =>
    withinDetailBytes(
      milestones.length === 0
        ? `The goal ${goal} names no milestones, so leave marks out`
        : `The goal ${goal} has no milestone ${marks}; mark one of its milestones: ${listed(milestones)}`,
    ),
  perIdWanted: (goal: string, per: string) =>
    withinDetailBytes(
      `The goal ${goal} is judged one ${per} at a time, so give per_id, a pointer to the id of the ${per} in the output`,
    ),
  eachUnwanted: (goal: string) =>
    withinDetailBytes(`The goal ${goal} is judged as a whole, not one thing at a time, so leave each out`),
  finalWithoutMeasures: 'final says the measure will not change any more, so it needs measures beside it',
  asOfWithoutMeasures: 'as_of says when the measure was true, so it needs measures beside it',
  finalWithoutWindow: (goal: string) =>
    withinDetailBytes(`The goal ${goal} has no window, so its measure is never final; leave final out`),
};
