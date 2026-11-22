import { InvalidInput, type Issue } from '@on.auto/operations';

export const goalQuestions = {
  purpose: 'What should this playbook achieve for you, and how will you know it worked?',
  change: 'What change do you want from this?',
  conviction: 'What would convince you it worked?',
  hearing:
    'When this passes, fails or becomes overdue (no final measurement in time), do you want to be told immediately, in a summary, or not at all?',
  channel: 'Where should I tell you: which channel or address?',
  rhythm: 'How often should the summary be sent, and when?',
} as const;

export type GoalQuestion = keyof typeof goalQuestions;

interface AgentGoalIssue {
  readonly pointer: string;
  readonly detail: string;
  readonly fixed_by: 'agent';
}

interface PersonGoalIssue {
  readonly pointer: string;
  readonly detail: string;
  readonly fixed_by: 'person';
  readonly ask: string;
}

export type GoalIssue = AgentGoalIssue | PersonGoalIssue;

const mostDetailBytes = 256;

const encoder = new TextEncoder();

function bytesOf(text: string): number {
  return encoder.encode(text).length;
}

export function withinDetailBytes(text: string): string {
  if (bytesOf(text) <= mostDetailBytes) {
    return text;
  }
  const characters = Array.from(text);
  let kept = characters.length;
  while (bytesOf(`${characters.slice(0, kept).join('').trimEnd()}…`) > mostDetailBytes) {
    kept -= 1;
  }
  return `${characters.slice(0, kept).join('').trimEnd()}…`;
}

function opened(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function agentIssue(pointer: string, detail: string): AgentGoalIssue {
  return { pointer, detail: withinDetailBytes(opened(detail)), fixed_by: 'agent' };
}

export function personIssue(pointer: string, question: GoalQuestion, about: string): PersonGoalIssue {
  const ask = goalQuestions[question];
  return { pointer, detail: withinDetailBytes(`Ask the person: ${ask} ${opened(about)}`), fixed_by: 'person', ask };
}

export function isAskedOfThePerson(issue: GoalIssue): issue is PersonGoalIssue {
  return issue.fixed_by === 'person';
}

const notReplacingWords = 'These goals cannot replace the goals saved before';

export function notReplacing(issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({
    detail: notReplacingWords,
    issues: issues.map(({ pointer, detail }) => ({ pointer, detail })),
  });
}

export function retiredWords(id: string): string {
  return `The goal ${id} is retired; a yes is recorded only for goals that are not retired`;
}

export function changedSince(id: string, seen: number, now: number): string {
  return [
    `The goal ${id} changed after version ${String(seen)}, and is at version ${String(now)} now.`,
    'Show the person the goal as it is saved now, and ask again before you record a yes',
  ].join(' ');
}
