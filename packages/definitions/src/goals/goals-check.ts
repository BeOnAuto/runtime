import { Result, Schema } from 'effect';
import { isAlias, isCollection, isNode, isScalar, LineCounter, parseDocument, visit } from 'yaml';

import { goalIssuesOf, type PlaybookNaming } from './goal-check.ts';
import { isMapping } from './goal-fields.ts';
import { agentIssue, personIssue, type GoalIssue } from './goal-issues.ts';
import { GoalsSchema, mostGoals, mostGoalsBytes, type Goals, type GoalsDocument } from './goals-document.ts';

interface YamlError {
  readonly pos: readonly [number, number];
  readonly message: string;
}

const parseOptions = {
  schema: 'core',
  version: '1.2',
  strict: true,
  merge: false,
  uniqueKeys: true,
  stringKeys: true,
  prettyErrors: false,
} as const;

const encoder = new TextEncoder();

function refusalOf(node: unknown): string | undefined {
  if (isAlias(node)) {
    return `An alias (*${node.source}) is not allowed; write the value out`;
  }
  if ((isScalar(node) || isCollection(node)) && node.anchor !== undefined) {
    return `An anchor (&${node.anchor}) is not allowed`;
  }
  return isNode(node) && node.tag !== undefined ? 'A tag is not allowed; write the value plainly' : undefined;
}

function refusedNodesIn(text: string): readonly GoalIssue[] {
  const issues: GoalIssue[] = [];
  visit(parseDocument(text, parseOptions), (_key, node) => {
    const refusal = refusalOf(node);
    if (refusal !== undefined) {
      issues.push(agentIssue('', refusal));
    }
  });
  return issues;
}

const hashAsText = '\u{E000}';

const hashAfterWords = /(?<=\S[ \t]+)#(?=\S)/gu;

function withHashesAsText(text: string): string {
  return text.includes(hashAsText) ? text : text.replace(hashAfterWords, hashAsText);
}

function hashesRestoredIn(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replaceAll(hashAsText, '#');
  }
  if (Array.isArray(value)) {
    return value.map((inner: unknown) => hashesRestoredIn(inner));
  }
  return isMapping(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, inner]: readonly [string, unknown]) => [key, hashesRestoredIn(inner)]),
      )
    : value;
}

function goalsValueOf(text: string): Result.Result<unknown, readonly GoalIssue[]> {
  if (encoder.encode(text).length > mostGoalsBytes) {
    return Result.fail([
      agentIssue(
        '',
        `The goals may take at most ${mostGoalsBytes.toLocaleString('en-US')} bytes; keep each goal shorter`,
      ),
    ]);
  }
  const marked = withHashesAsText(text);
  const lineCounter = new LineCounter();
  const document = parseDocument(marked, { ...parseOptions, lineCounter });
  const lineAt = (offset: number): number => lineCounter.linePos(offset).line;
  if (document.errors.length > 0) {
    return Result.fail(
      document.errors.map(({ pos, message }: YamlError) =>
        agentIssue('', `Line ${String(lineAt(pos[0]))}: ${message}`),
      ),
    );
  }
  const refused = refusedNodesIn(marked);
  if (refused.length > 0) {
    return Result.fail(refused);
  }
  const value: unknown = marked === text ? document.toJS() : hashesRestoredIn(document.toJS());
  return Result.succeed(value);
}

export type FurtherGoalsCheck = (goals: Goals) => readonly GoalIssue[];

export interface GoalsChecking {
  readonly naming?: PlaybookNaming;
  readonly further?: readonly FurtherGoalsCheck[];
}

const goalsOf = Schema.decodeUnknownSync(GoalsSchema);

const noGoals = personIssue('', 'purpose', 'No goals were given.');

function idIssuesOf(goals: readonly unknown[]): readonly GoalIssue[] {
  const ids = goals.map((goal) => (isMapping(goal) && typeof goal['id'] === 'string' ? goal['id'] : undefined));
  return ids.flatMap((id, index) =>
    id !== undefined && ids.indexOf(id) < index
      ? [agentIssue(`/${String(index)}/id`, `The goal ${id} is named more than once`)]
      : [],
  );
}

function structuralIssuesOf(value: unknown, naming: PlaybookNaming | undefined): readonly GoalIssue[] {
  if (value === null || (Array.isArray(value) && value.length === 0)) {
    return [noGoals];
  }
  if (!Array.isArray(value)) {
    return [agentIssue('', 'The goals are a list of goals, with no key around it')];
  }
  return [
    ...(value.length > mostGoals
      ? [agentIssue('', `A playbook has at most ${String(mostGoals)} goals, and these are ${String(value.length)}`)]
      : []),
    ...value.flatMap((goal: unknown, index) => goalIssuesOf(goal, index, naming)),
    ...idIssuesOf(value),
  ];
}

export function goalsDocumentOf(
  source: string,
  { naming, further = [] }: GoalsChecking = {},
): Result.Result<GoalsDocument, readonly GoalIssue[]> {
  return Result.flatMap(goalsValueOf(source), (value) => {
    const issues = structuralIssuesOf(value, naming);
    if (issues.length > 0) {
      return Result.fail(issues);
    }
    const goals = goalsOf(value);
    const furtherIssues = further.flatMap((check) => check(goals));
    return furtherIssues.length > 0 ? Result.fail(furtherIssues) : Result.succeed({ source, goals });
  });
}
