export interface ProgramIssue {
  readonly detail: string;
  readonly line: number | null;
}

export type Limit = 'work' | 'memory' | 'stack' | 'deadline';

export type ProgramFailure =
  | { readonly ran: 'raised'; readonly issue: ProgramIssue; readonly work: number }
  | { readonly ran: 'exhausted'; readonly limit: Limit; readonly issue: ProgramIssue; readonly work: number }
  | { readonly ran: 'unfit'; readonly issue: ProgramIssue; readonly work: number }
  | { readonly ran: 'oversized'; readonly issue: ProgramIssue; readonly work: number };

export type ProgramRun = { readonly ran: 'answered'; readonly text: string; readonly work: number } | ProgramFailure;

export type Form = 'module' | 'expression';

export interface Evaluation {
  readonly budget: number;
  readonly deadlineAt: number;
  readonly moment: number;
}

const exhaustedWords: Readonly<Record<Limit, string>> = {
  work: 'The program did more work than it may',
  memory: 'The program used more memory than it may',
  stack: 'The program went deeper than the stack it runs on allows',
  deadline: 'The program ran past its deadline',
};

export function exhaustedBy(limit: Limit, work: number): ProgramFailure {
  return { ran: 'exhausted', limit, issue: { detail: exhaustedWords[limit], line: null }, work };
}

export function oversizedBy(most: number, work: number): ProgramFailure {
  return { ran: 'oversized', issue: { detail: `The answer takes more than ${most} bytes as JSON`, line: null }, work };
}
