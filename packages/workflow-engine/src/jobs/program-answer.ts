import { jsonOfText, type Json } from '../dsl/json.ts';
import { mostIssueBytes, textWithin, utf8BytesWithin } from '../programs/byte-sizes.ts';
import { moduleRun, type ModuleRun } from '../programs/module-runs.ts';
import type { ProgramIssue } from '../programs/program-run.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import type { ProgramAnswerSchema, ProgramJob } from './program-messages.ts';

export type ProgramAnswerData = typeof ProgramAnswerSchema.Encoded;

export interface OutputIssue {
  readonly pointer: string;
  readonly detail: string;
}

export type OutputCheck = (output: Json) => readonly OutputIssue[];

export interface ProgramHost {
  readonly now: () => number;
  readonly instance: SandboxInstance;
  readonly check: OutputCheck;
}

export const unchecked: OutputCheck = () => [];

function cut(issue: ProgramIssue): ProgramIssue {
  return { ...issue, detail: textWithin(issue.detail, mostIssueBytes) };
}

function checkedAnswer(text: string, bytes: number, work: number, check: OutputCheck): ProgramAnswerData {
  const issues = check(jsonOfText(text));
  return issues.length === 0
    ? { ran: 'answered', output: text, bytes, work }
    : {
        ran: 'mismatched',
        issues: issues.map(({ pointer, detail }) => ({
          pointer: textWithin(pointer, mostIssueBytes),
          detail: textWithin(detail, mostIssueBytes),
        })),
        work,
      };
}

function answerFrom(run: ModuleRun, mostOutputBytes: number, check: OutputCheck): ProgramAnswerData {
  if (run.ran === 'refused') {
    return { ran: 'refused', issue: cut(run.issue) };
  }
  if (run.ran === 'oversized') {
    return { ran: 'oversized', work: run.work };
  }
  if (run.ran !== 'answered') {
    return { ...run, issue: cut(run.issue) };
  }
  const bytes = utf8BytesWithin(run.text, mostOutputBytes);
  return bytes > mostOutputBytes
    ? { ran: 'oversized', work: run.work }
    : checkedAnswer(run.text, bytes, run.work, check);
}

export function answerOf(request: ProgramJob, { now, instance, check }: ProgramHost): ProgramAnswerData {
  const run = moduleRun(
    instance,
    { stackBytes: request.stackBytes, mostAnswerBytes: request.mostOutputBytes, clock: now },
    {
      source: request.source,
      entry: request.entry,
      arguments: request.arguments,
      evaluation: { budget: request.budget, deadlineAt: request.deadlineAt, moment: request.moment },
    },
  );
  return answerFrom(run, request.mostOutputBytes, check);
}
