import type { Arguments, ExpressionUnit } from '../programs/expression-units.ts';
import type { Limit, ProgramIssue, ProgramRun } from '../programs/program-run.ts';
import { jsonOfText, type Json } from './json.ts';

export interface Budget {
  readonly now: number;
  readonly mostWork: number;
  readonly deadlineAt: number;
}

export type Evaluation =
  | { readonly value: Json; readonly work: number }
  | { readonly problem: string; readonly work: number; readonly exhausted: false }
  | { readonly problem: string; readonly work: number; readonly exhausted: true; readonly limit: Bound };

export type Bound = Exclude<Limit, 'stack'>;

const enclosedExpression = /^\s*\$\{(?<body>[\s\S]*)\}\s*$/u;

const longestProblem = 1000;

export function enclosedBody(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? enclosedExpression.exec(value)?.groups?.['body'] : undefined;
}

export function expressionSource(text: string): string {
  return enclosedBody(text) ?? text;
}

function shortened(problem: string): string {
  return problem.length > longestProblem ? `${problem.slice(0, longestProblem)}…` : problem;
}

function lineIn(source: string, line: number | null): number {
  return Math.min(line ?? 1, source.split('\n').length);
}

function problemOf(source: string, { detail, line }: ProgramIssue): string {
  const at = lineIn(source, line);
  return shortened(`${source.trim()}: ${detail}${at === 1 ? '' : ` (line ${at})`}`);
}

export function evaluationOf(source: string, run: ProgramRun): Evaluation {
  if (run.ran === 'answered') {
    return { value: jsonOfText(run.text), work: run.work };
  }
  if (run.ran === 'exhausted' && run.limit !== 'stack') {
    return { problem: problemOf(source, run.issue), work: run.work, exhausted: true, limit: run.limit };
  }
  return { problem: problemOf(source, run.issue), work: run.work, exhausted: false };
}

export function runExpression(
  unit: ExpressionUnit,
  source: string,
  values: Arguments,
  { now, mostWork, deadlineAt }: Budget,
): Evaluation {
  return evaluationOf(source, unit.evaluate(source, values, { budget: mostWork, deadlineAt, moment: now }));
}
