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
